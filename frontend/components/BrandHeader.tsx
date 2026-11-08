'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { brand } from '@/config/brand';

/** 页面顶栏：品牌名 + 当前页面名，告诉用户"我在哪" */
export default function BrandHeader({ title }: { title?: string }) {
  return (
    <>
      <header className="fixed top-0 right-0 left-[var(--app-sidebar-width)] z-30 h-14 bg-white border-b border-gray-200 flex items-center gap-1.5 px-4 min-w-0 transition-[left] duration-300">
        <Link href="/" className="flex items-center hover:opacity-80 transition-opacity flex-shrink-0">
          <span className={title ? 'text-sm text-gray-400' : 'font-bold text-sm text-gray-800 tracking-tight'}>
            {brand.name}
          </span>
        </Link>
        {title && (
          <>
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
            <span className="truncate text-sm font-semibold text-gray-800">{title}</span>
          </>
        )}
      </header>
      <div className="h-14 flex-shrink-0" />
    </>
  );
}
