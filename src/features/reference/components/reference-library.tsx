import Link from "next/link";

export function ReferenceLibrary() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">레퍼런스 라이브러리</h1>
        <Link href="/gallery" className="text-sm">
          사진첩
        </Link>
      </header>
      <p>따라 촬영할 레퍼런스 사진을 선택하는 기능을 준비 중입니다.</p>
    </main>
  );
}
