import { Suspense } from 'react';
import PipelinePage from '@/components/pipelines/PipelinePage';

export default function DigitalHumanPipelinePage() {
  return (
    <Suspense fallback={null}>
      <PipelinePage
        pipeline="digital_human"
        title="数字人口播"
        subtitle="上传一张人物照片，写好口播文案，生成人物开口说话的视频"
      />
    </Suspense>
  );
}
