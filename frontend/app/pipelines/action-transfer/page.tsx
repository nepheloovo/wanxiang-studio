import { Suspense } from 'react';
import PipelinePage from '@/components/pipelines/PipelinePage';

export default function ActionTransferPipelinePage() {
  return (
    <Suspense fallback={null}>
      <PipelinePage
        pipeline="action_transfer"
        title="动作迁移"
        subtitle="上传一张人物图和一段动作视频，让图里的人做出同样的动作"
      />
    </Suspense>
  );
}
