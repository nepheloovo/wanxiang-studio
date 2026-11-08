'use client';

import type { ProviderGroup } from '@/config/models';

/** 按服务商分组的模型下拉；当前值不在列表里时仍然显示它，避免误显示成第一个选项 */
export default function ModelSelect({
  value,
  providers,
  onChange,
  className,
}: {
  value: string;
  providers: ProviderGroup[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const known = providers.some(group => group.models.some(model => model.id === value));
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className={className || 'bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-gray-700 outline-none'}
    >
      {value && !known && <option value={value}>{value}（当前配置）</option>}
      {providers.map(group => (
        <optgroup key={group.provider} label={group.label}>
          {group.models.map(model => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
