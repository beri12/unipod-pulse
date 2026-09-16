'use client';

import { redirect } from 'next/navigation';

/** Meeting administration lives on the meetings page (see admin/documents). */
export default function AdminMeetingsPage() {
  redirect('/meetings');
}
