'use client';

import { redirect } from 'next/navigation';

/**
 * Document administration is the documents page itself: admin controls (upload,
 * reprocess, delete) already render there for administrators, so duplicating
 * the table here would mean two places to keep correct.
 */
export default function AdminDocumentsPage() {
  redirect('/documents');
}
