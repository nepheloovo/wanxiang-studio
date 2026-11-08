import { Suspense } from 'react';
import PipelinePage from '@/components/pipelines/PipelinePage';

export default function StandardPipelinePage() {
  return (
    <Suspense fallback={null}>
      <PipelinePage
        pipeline="standard"
        title="文艺短视频"
        subtitle="写一个主题或一段文案，AI 自动配图、配音，生成短视频"
      />
    </Suspense>
  );
}
