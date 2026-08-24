import { Button, Empty, Input, List, Select, Space, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { fmtTime, textOf } from '@/utils/format';

const fieldOptions = [
  { value: '', label: '全部字段' },
  { value: 'versionNo,title,change,requirement,spec,tag,note,projectName,description', label: '版本与项目' },
  { value: 'requirement,change,spec', label: '需求与规格' },
  { value: 'tag', label: '标签' },
];

function snippetText(item: any) {
  const snippet = item?.snippet;
  if (!snippet?.text) return textOf(item?.versionTitle || item?.projectName);
  return snippet.text;
}

export default function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<any[]>([]);
  const [query, setQuery] = useState(params.get('q') || '');
  const [project, setProject] = useState(params.get('project') || '');
  const [field, setField] = useState(params.get('field') || '');
  const [result, setResult] = useState<any>({ total: 0, results: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const hasSearch = useMemo(
    () => Boolean((params.get('q') || '').trim() || params.get('project') || params.get('field')),
    [params],
  );

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch {
      setProjects([]);
    }
  }, []);

  const runSearch = useCallback(async () => {
    const q = params.get('q') || '';
    const selectedProject = params.get('project') || '';
    const selectedField = params.get('field') || '';
    setQuery(q);
    setProject(selectedProject);
    setField(selectedField);
    if (!hasSearch) {
      setResult({ total: 0, results: [] });
      return;
    }
    setLoading(true);
    setError('');
    try {
      setResult(await api.search(q, {
        project: selectedProject || null,
        field: selectedField || null,
        limit: 60,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  }, [hasSearch, params]);

  const submit = useCallback(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    if (project) next.set('project', project);
    if (field) next.set('field', field);
    setParams(next, { replace: false });
  }, [field, project, query, setParams]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="全局检索"
        title="搜索"
        description="检索项目、版本、规格、变更、需求和标签。"
      />

      <section className="fl-surface fl-search-panel" aria-label="搜索条件">
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined />}
          value={query}
          placeholder="输入版本号、需求编号、变更说明或规格内容"
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={submit}
        />
        <Space wrap>
          <Select
            className="fl-filter-select"
            value={project}
            options={[
              { value: '', label: '全部项目' },
              ...projects.map((item) => ({ value: item.slug, label: `${item.name} · ${item.slug}` })),
            ]}
            onChange={setProject}
          />
          <Select
            className="fl-filter-select"
            value={field}
            options={fieldOptions}
            onChange={setField}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={submit}>搜索</Button>
        </Space>
      </section>

      <State loading={loading} error={error} onRetry={runSearch} empty={hasSearch && !result.results?.length} emptyText="没有匹配结果">
        {!hasSearch ? (
          <div className="fl-state fl-state-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入关键词开始搜索" />
          </div>
        ) : (
          <section className="fl-surface fl-list-surface" aria-label="搜索结果">
            <div className="fl-section-toolbar">
              <strong>{result.total || 0} 个结果</strong>
            </div>
            <List
              dataSource={result.results || []}
              renderItem={(item: any) => (
                <List.Item
                  className="fl-clickable-row"
                  onClick={() => {
                    if (item.project && item.versionNo) {
                      navigate(`/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.versionNo)}`);
                    } else if (item.project) {
                      navigate(`/projects/${encodeURIComponent(item.project)}`);
                    }
                  }}
                >
                  <List.Item.Meta
                    title={(
                      <span className="fl-table-title">
                        <span className="fl-mono">{textOf(item.versionNo || item.project)}</span>
                        {' '}
                        {textOf(item.versionTitle || item.projectName)}
                      </span>
                    )}
                    description={(
                      <span>
                        {textOf(item.projectName || item.project)}
                        {' · '}
                        {textOf(item.fieldLabel || item.field)}
                        {item.updatedAt ? ` · ${fmtTime(item.updatedAt)}` : ''}
                        <br />
                        {snippetText(item)}
                      </span>
                    )}
                  />
                  <Space wrap>
                    {item.versionStatus ? <Tag>{item.versionStatus}</Tag> : null}
                    {item.reviewStatus ? <Tag>{item.reviewStatus}</Tag> : null}
                  </Space>
                </List.Item>
              )}
            />
          </section>
        )}
      </State>
    </main>
  );
}
