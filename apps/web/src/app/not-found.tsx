import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="text-center">
        <div className="text-[40px] font-bold text-ink">404</div>
        <p className="mt-1 text-[13px] text-muted">This page does not exist or was moved.</p>
        <Link href="/home" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700">
          Go home
        </Link>
      </div>
    </div>
  );
}
