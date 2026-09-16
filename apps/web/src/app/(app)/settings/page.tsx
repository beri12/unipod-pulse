'use client';

import type { SystemStatus } from '@unipods/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
} from '@unipods/ui';
import * as React from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers';
import { authApi, healthApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/format';

export default function SettingsPage() {
  const { user, isAdmin, refresh, signOut } = useAuth();
  const [name, setName] = React.useState(user?.name ?? '');

  React.useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const status = useQuery<SystemStatus>({ queryKey: ['health'], queryFn: healthApi.status });

  const save = useMutation({
    mutationFn: () => authApi.updateProfile({ name: name.trim() }),
    onSuccess: async () => {
      await refresh();
      toast.success('Profile updated');
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>
            {user?.email}
            {user ? ` · member since ${formatDate(user.createdAt)}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Display name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={80}
                required
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" loading={save.isPending} disabled={name.trim() === user?.name}>
                Save changes
              </Button>
              {isAdmin ? <Badge variant="outline">Administrator</Badge> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>How answers are produced</CardTitle>
          <CardDescription>
            Answers come only from your community&apos;s indexed content. When retrieval finds no
            supporting evidence, the assistant says so and records the question as a gap rather
            than guessing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : status.data ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Row label="AI provider" value={status.data.ai.provider} />
              <Row label="Chat model" value={status.data.ai.chatModel} />
              <Row label="Embedding model" value={status.data.ai.embeddingModel} />
              <Row label="Transcription" value={status.data.ai.transcriptionModel} />
              <Row label="Service status" value={status.data.status} />
              <Row label="Demo mode" value={status.data.demoMode ? 'On' : 'Off'} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Status is unavailable right now.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Signing out revokes this device&apos;s refresh token on the server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
