'use client';

import { useParams } from 'next/navigation';
import { ContactsApp } from '@/components/contacts/ContactsApp';

export default function Page() {
  const { id = [] } = useParams<{ id?: string[] }>();
  return <ContactsApp id={id[0]} />;
}
