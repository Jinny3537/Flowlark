import { useParams } from '@umijs/max';
import { Descriptions, List, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { textOf } from '@/utils/format';

export default function RequirementDetail() {
  const { code = '' } = useParams();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      setItem(await api.getRequirement(code));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取需求详情');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="需求详情"
        title={item?.title || code}
        description={item?.description || '查看需求属性与关联原型版本。'}
        backTo="/requirements"
      />
      <State loading={loading} error={error} onRetry={load} empty={!item} emptyText="没有找到需求">
        <div className="fl-detail-stack">
          <section className="fl-detail-summary">
            <Descriptions column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="编号"><span className="fl-mono">{code}</span></Descriptions.Item>
              <Descriptions.Item label="状态"><Tag>{textOf(item?.derivedStatus, '未开始')}</Tag></Descriptions.Item>
              <Descriptions.Item label="项目">{textOf(item?.project, '未分项目')}</Descriptions.Item>
              <Descriptions.Item label="模块">{textOf(item?.module, '未分模块')}</Descriptions.Item>
              <Descriptions.Item label="负责人">{textOf(item?.owner)}</Descriptions.Item>
              <Descriptions.Item label="来源">{item?.external ? '需求池' : '本地'}</Descriptions.Item>
            </Descriptions>
          </section>
          <section className="fl-detail-section">
            <h2>关联版本</h2>
            <List
              locale={{ emptyText: '还没有关联版本' }}
              dataSource={item?.versions || []}
              renderItem={(version: any) => (
                <List.Item>
                  <List.Item.Meta title={`${version.project} / ${version.versionNo || version.no}`} description={textOf(version.title)} />
                </List.Item>
              )}
            />
          </section>
        </div>
      </State>
    </main>
  );
}
