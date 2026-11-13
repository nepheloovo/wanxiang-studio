'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import BrandHeader from '@/components/BrandHeader';
import GalleryPage from '@/components/GalleryPage';
import ProjectsPage from '@/components/ProjectsPage';

function WorksTabs() {
  const tab = useSearchParams().get('tab') === 'projects' ? 'projects' : 'images';
  return (
    <div className="min-h-screen bg-gray-50">
      <BrandHeader title="作品" />
      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
        <div className="inline-flex gap-1 rounded-xl border border-gray-200 p-1">
          {([['images', '图片作品'], ['projects', '视频项目']] as const).map(([id, label]) => (
            <Link key={id} href={`/projects?tab=${id}`} className={clsx('sfa-panel-chip !h-9 border-0 px-4 !text-sm', tab === id && 'is-active')}>
              {label}
            </Link>
          ))}
        </div>
      </div>
      {tab === 'images' ? <GalleryPage /> : <ProjectsPage embedded />}
    </div>
  );
}

export default function Works() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">加载中…</div>}>
      <WorksTabs />
    </Suspense>
  );
}
