export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12">
      <section className="space-y-6">
        <p className="text-sm font-semibold tracking-wide text-emerald-700">
          Kawashima Motors
        </p>
        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-zinc-950 sm:text-5xl">
            車検予約システム
          </h1>
          <p className="max-w-2xl text-base leading-8 text-zinc-700">
            Next.js App Router、TypeScript、Tailwind CSS、Supabase client
            の初期構築が完了しています。
          </p>
        </div>
        <div className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="font-semibold text-zinc-950">App Router</p>
            <p className="mt-2">src/app 配下でページを管理します。</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="font-semibold text-zinc-950">Supabase</p>
            <p className="mt-2">src/lib/supabase に client を配置済みです。</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="font-semibold text-zinc-950">TypeScript</p>
            <p className="mt-2">strict mode と @ alias を有効化しています。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
