'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label } from '@unipods/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PulseMark } from '@/components/app-shell';
import { useAuth } from '@/components/providers';
import { describeError } from '@/lib/errors';

const loginSchema = z.object({
  email: z.string().min(1, 'Enter your email address').email('That does not look like an email address'),
  password: z.string().min(1, 'Enter your password'),
});

const registerSchema = loginSchema.extend({
  name: z.string().min(2, 'Enter your name'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200, 'That password is too long'),
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next');

  const form = useForm<RegisterValues>({
    resolver: zodResolver(isRegister ? registerSchema : (loginSchema as unknown as typeof registerSchema)),
    defaultValues: { name: '', email: '', password: '' },
  });

  // A signed-in visitor has no business on these pages.
  React.useEffect(() => {
    if (!auth.loading && auth.user) router.replace(next || '/chat');
  }, [auth.loading, auth.user, next, router]);

  const onSubmit = form.handleSubmit(async (values: RegisterValues | LoginValues) => {
    try {
      if (isRegister) {
        const registerValues = values as RegisterValues;
        await auth.register(registerValues.name, registerValues.email, registerValues.password);
        toast.success('Welcome to UniPods Pulse');
      } else {
        await auth.signIn(values.email, values.password);
      }
      router.replace(next || '/chat');
    } catch (error) {
      toast.error(describeError(error));
    }
  });

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <PulseMark className="size-10" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">
            {isRegister ? 'Create your account' : 'Sign in to UniPods Pulse'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your community. One intelligent memory.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          {isRegister ? (
            <Field
              id="name"
              label="Name"
              autoComplete="name"
              error={form.formState.errors.name?.message}
              {...form.register('name')}
            />
          ) : null}

          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />

          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            hint={isRegister ? 'At least 10 characters.' : undefined}
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />

          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            {isRegister ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {isRegister ? 'Already have an account? ' : 'New here? '}
          <Link
            href={isRegister ? '/login' : '/register'}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {isRegister ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </div>
    </main>
  );
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  ({ id, label, error, hint, ...props }, ref) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        ref={ref}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  ),
);
Field.displayName = 'Field';
