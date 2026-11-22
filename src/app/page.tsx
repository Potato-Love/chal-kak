
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col bg-neutral-950 text-white">
      <header className="flex items-center justify-between px-5 py-4">
        <h1 className="text-xl font-bold">찰칵</h1>
        <Link
          href="/gallery"
          className="text-sm text-neutral-300"
        >
          사진첩
        </Link>
      </header>

      <section className="relative flex flex-1 items-center justify-center bg-neutral-900">
        <p className="text-sm text-neutral-400">
          카메라 미리보기 영역
        </p>
      </section>

      <footer className="flex flex-col gap-4 px-5 py-6">
        <Link
          href="/references"
          className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-black"
        >
          레퍼런스 선택
        </Link>

        <button
          type="button"
          disabled
          className="mx-auto h-16 w-16 rounded-full border-4 border-white bg-white/20 disabled:opacity-50"
          aria-label="촬영 기능 준비 중"
        />
      </footer>
    </main>
  );
}
