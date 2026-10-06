'use client';

import { Suspense } from 'react';
import { TasksApp } from '@/components/tasks/TasksApp';

export default function Page() {
  return (
    <Suspense>
      <TasksApp />
    </Suspense>
  );
}
