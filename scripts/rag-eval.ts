/**
 * RAG evaluation.
 *
 * Runs a fixed question set against the live knowledge base and reports four
 * things, each measured rather than asserted:
 *
 *   retrieval relevance   did an expected source appear anywhere in retrieval?
 *   source correctness    did an expected source appear among the citations?
 *   answer groundedness   is every quoted span present verbatim in a chunk?
 *   refusal correctness   did it refuse exactly when it should have?
 *
 * Groundedness is the important one: it checks the answer against the retrieved
 * text, so a fluent answer that quotes something nobody said still fails.
 *
 * Run with: pnpm rag:eval [--json] [--dataset path]
 */
import { createAiBundle } from '@unipods/ai';
import { loadEnv } from '@unipods/config';
import {
  createPrismaClient,
  searchKeywordChunks,
  searchSimilarChunks,
  type RetrievedRow,
} from '@unipods/database';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface EvalCase {
  id: string;
  question: string;
  expectAnswered: boolean;
  expectedSourceTitles?: string[];
  mustContain?: string[];
  mustNotContain?: string[];
}

interface CaseResult {
  id: string;
  question: string;
  answered: boolean;
  refusalCorrect: boolean;
  retrievalHit: boolean | null;
  citationHit: boolean | null;
  grounded: boolean;
  contentOk: boolean;
  citedTitles: string[];
  retrievedTitles: string[];
  ungroundedQuotes: string[];
  missingPhrases: string[];
  latencyMs: number;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const datasetPath = resolve(
  process.cwd(),
  args[args.indexOf('--dataset') + 1] && args.includes('--dataset')
    ? (args[args.indexOf('--dataset') + 1] as string)
    : 'scripts/rag-eval.dataset.json',
);

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const ai = createAiBundle(env);

  const dataset = JSON.parse(readFileSync(datasetPath, 'utf8')) as { cases: EvalCase[] };
  const demoFilter = env.DEMO_MODE ? { onlyDemo: true } : { includeDemo: false };

  const results: CaseResult[] = [];

  for (const testCase of dataset.cases) {
    const started = Date.now();

    const embedding = await ai.embeddings.embedText(testCase.question);
    const [vectorRows, keywordRows] = await Promise.all([
      searchSimilarChunks(prisma, embedding, { ...demoFilter, limit: env.RAG_TOP_K * 4 }),
      searchKeywordChunks(prisma, testCase.question, { ...demoFilter, limit: env.RAG_TOP_K * 4 }),
    ]);

    // Same blend as RankingService, kept deliberately simple here so the
    // evaluation does not depend on the API being up.
    const merged = new Map<string, RetrievedRow>();
    for (const row of [...vectorRows, ...keywordRows]) {
      const existing = merged.get(row.chunkId);
      if (existing) {
        existing.vectorScore = Math.max(existing.vectorScore, row.vectorScore);
        existing.keywordScore = Math.max(existing.keywordScore, row.keywordScore);
      } else {
        merged.set(row.chunkId, { ...row });
      }
    }
    const ranked = [...merged.values()]
      .map((row) => ({
        row,
        score:
          env.RAG_WEIGHT_SEMANTIC * row.vectorScore + env.RAG_WEIGHT_KEYWORD * row.keywordScore,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, env.RAG_TOP_K)
      .map((entry) => entry.row);

    const context = ranked.map((row, index) => ({
      index: index + 1,
      sourceId: row.sourceId,
      title: row.sourceTitle,
      kind: row.sourceType,
      locator: '',
      date: row.sourceOccurredAt ? row.sourceOccurredAt.toISOString() : null,
      content: row.content,
    }));

    const answer = await ai.llm.generateAnswer({
      question: testCase.question,
      context,
      history: [],
    });

    const citedRows = answer.citedIndexes
      .map((index) => ranked[index - 1])
      .filter((row): row is RetrievedRow => Boolean(row));

    const retrievedTitles = [...new Set(ranked.map((row) => row.sourceTitle))];
    const citedTitles = [...new Set(citedRows.map((row) => row.sourceTitle))];
    const expected = testCase.expectedSourceTitles ?? [];

    const answered = answer.answered && citedRows.length > 0;
    const refusalCorrect = answered === testCase.expectAnswered;

    const retrievalHit = expected.length > 0 ? expected.some((title) => retrievedTitles.includes(title)) : null;
    const citationHit = expected.length > 0 ? expected.some((title) => citedTitles.includes(title)) : null;

    const { grounded, ungroundedQuotes } = checkGroundedness(answer.answer, ranked);

    const missingPhrases = (testCase.mustContain ?? []).filter(
      (phrase) => !answer.answer.toLowerCase().includes(phrase.toLowerCase()),
    );
    const forbidden = (testCase.mustNotContain ?? []).filter((phrase) =>
      answer.answer.toLowerCase().includes(phrase.toLowerCase()),
    );

    results.push({
      id: testCase.id,
      question: testCase.question,
      answered,
      refusalCorrect,
      retrievalHit,
      citationHit,
      grounded,
      contentOk: answered ? missingPhrases.length === 0 && forbidden.length === 0 : true,
      citedTitles,
      retrievedTitles,
      ungroundedQuotes,
      missingPhrases: [...missingPhrases, ...forbidden.map((phrase) => `(forbidden) ${phrase}`)],
      latencyMs: Date.now() - started,
    });
  }

  await prisma.$disconnect();
  report(results, { provider: ai.llm.providerName, model: ai.llm.model, demoMode: env.DEMO_MODE });
}

/**
 * Every quoted span in the answer must appear verbatim in a retrieved chunk.
 *
 * This is the check that catches a confident-sounding fabrication: an answer
 * can only quote what was actually retrieved.
 */
function checkGroundedness(
  answer: string,
  rows: RetrievedRow[],
): { grounded: boolean; ungroundedQuotes: string[] } {
  const haystack = rows.map((row) => normalise(row.content)).join('   ');
  const quotes = [...answer.matchAll(/"([^"]{12,})"/g)].map((match) => match[1] as string);
  const ungrounded = quotes.filter((quote) => !haystack.includes(normalise(quote)));
  return { grounded: ungrounded.length === 0, ungroundedQuotes: ungrounded };
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[‘’]/g, "'").trim().toLowerCase();
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${Math.round((numerator / denominator) * 100)}% (${numerator}/${denominator})`;
}

function report(
  results: CaseResult[],
  meta: { provider: string; model: string; demoMode: boolean },
): void {
  const withExpectations = results.filter((result) => result.retrievalHit !== null);
  const answerable = results.filter((result) => result.answered);

  const summary = {
    cases: results.length,
    provider: meta.provider,
    model: meta.model,
    demoMode: meta.demoMode,
    retrievalRelevance: percent(
      withExpectations.filter((result) => result.retrievalHit).length,
      withExpectations.length,
    ),
    sourceCorrectness: percent(
      withExpectations.filter((result) => result.citationHit).length,
      withExpectations.length,
    ),
    answerGroundedness: percent(
      answerable.filter((result) => result.grounded).length,
      answerable.length,
    ),
    refusalCorrectness: percent(
      results.filter((result) => result.refusalCorrect).length,
      results.length,
    ),
    expectedContent: percent(
      results.filter((result) => result.contentOk).length,
      results.length,
    ),
    medianLatencyMs: median(results.map((result) => result.latencyMs)),
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ summary, results }, null, 2)}\n`);
    return;
  }

  console.log('\nUniPods Pulse — RAG evaluation');
  console.log(`  provider ${meta.provider} (${meta.model})${meta.demoMode ? ' · demo mode' : ''}`);
  console.log(`  dataset  ${datasetPath}\n`);

  for (const result of results) {
    const problems: string[] = [];
    if (!result.refusalCorrect) {
      problems.push(result.answered ? 'answered when it should not have' : 'refused a question it should answer');
    }
    if (result.retrievalHit === false) problems.push('expected source not retrieved');
    else if (result.citationHit === false) problems.push('expected source retrieved but not cited');
    if (!result.grounded) problems.push(`ungrounded quote: "${result.ungroundedQuotes[0]}"`);
    if (result.missingPhrases.length > 0) problems.push(`missing: ${result.missingPhrases.join(', ')}`);

    const mark = problems.length === 0 ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${result.id}`);
    console.log(`      ${result.question}`);
    console.log(
      `      answered=${result.answered} cited=[${result.citedTitles.join(', ') || '-'}] ${result.latencyMs}ms`,
    );
    for (const problem of problems) console.log(`      ! ${problem}`);
  }

  console.log('\nMeasured on this dataset and this knowledge base:');
  console.log(`  retrieval relevance   ${summary.retrievalRelevance}`);
  console.log(`  source correctness    ${summary.sourceCorrectness}`);
  console.log(`  answer groundedness   ${summary.answerGroundedness}`);
  console.log(`  refusal correctness   ${summary.refusalCorrectness}`);
  console.log(`  expected content      ${summary.expectedContent}`);
  console.log(`  median latency        ${summary.medianLatencyMs} ms`);
  console.log(
    '\nThese numbers describe this dataset against the currently indexed content.\n' +
      'They are not a general accuracy claim, and they change with the AI provider.\n',
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
    : (sorted[middle] as number);
}

main().catch((error: unknown) => {
  console.error('Evaluation failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
