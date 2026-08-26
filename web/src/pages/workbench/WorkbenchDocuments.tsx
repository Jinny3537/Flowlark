import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Empty,
  Input,
  List,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { CSSProperties } from 'react';
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  HistoryOutlined,
  SaveOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { api } from '@/services/api';
import { fmtAbsolute, fmtSize, fmtTime, textOf } from '@/utils/format';
import {
  filterVersionFeedback,
  olderSiblings,
  requirementUrl,
} from './workbenchModel.js';
import {
  AttachmentsPanel,
  ChangeEditor,
  ChangeList,
  RequirementEditor,
  type ChangeItem,
  type RequirementLink,
} from './WorkbenchPrimitives';

type WorkbenchDocumentsProps = {
  activeTab: string;
  onTabChange: (key: string) => void;
  slug: string;
  versionNo: string;
  version: any;
  siblings: any[];
  canWrite: boolean;
  lockBaseline: boolean;
  maxFileBytes: number;
  requirementUrlTemplate: string;
  allTags: any[];
  specCommits: any[];
  feedbacks: any[];
  previewUrl?: string;
  onVersionChanged: (version?: any) => Promise<void>;
  onSpecHistoryChanged: () => Promise<void>;
  onTagsChanged: () => Promise<void>;
  onFeedbackChanged: () => Promise<void>;
};

type CumulativeResult = {
  items?: ChangeItem[];
  locationCounts?: Record<string, number>;
};

const panelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--fl-s-5)',
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 'var(--fl-s-2)',
  marginBottom: 'var(--fl-s-4)',
};

const itemSurfaceStyle: CSSProperties = {
  width: '100%',
  padding: 'var(--fl-s-3)',
  border: '1px solid var(--fl-line)',
  borderRadius: 'var(--fl-r-2)',
  background: 'var(--fl-surface)',
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message && error.message !== 'NETWORK'
    ? error.message
    : fallback;
}

function markdownHtml(markdown: string) {
  const html = marked.parse(markdown || '', {
    async: false,
    gfm: true,
    breaks: true,
  }) as string;
  return { __html: DOMPurify.sanitize(html) };
}

function openWindow(url?: string) {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('COPY_FAILED');
}

function specTemplate(versionNo: string, version: any) {
  const requirements = version?.requirements?.length
    ? version.requirements
      .map((item: RequirementLink) => `- ${item.code || ''} ${item.title || ''}`.trim())
      .join('\n')
    : '- 暂无';

  return `# ${versionNo} 技术规格书：${textOf(version?.title, versionNo)}

## 1. 背景与目标

- 业务目标：
- 适用范围：
- 不在本次范围：

## 2. 关联需求

${requirements}

## 3. 功能规则

| 模块 | 规则 | 异常处理 |
|---|---|---|
|  |  |  |

## 4. 数据与接口

- 输入：
- 输出：
- 权限：
- 审计记录：

## 5. 验收标准

- [ ] 原型行为符合规格
- [ ] 关键状态和异常路径已覆盖
- [ ] 相关需求已完成评审

## 6. 风险与待确认

- 风险：
- 待确认：
`;
}

export function WorkbenchDocuments({
  activeTab,
  onTabChange,
  slug,
  versionNo,
  version,
  siblings,
  canWrite,
  lockBaseline,
  maxFileBytes,
  requirementUrlTemplate,
  allTags,
  specCommits,
  feedbacks,
  previewUrl,
  onVersionChanged,
  onSpecHistoryChanged,
  onTagsChanged,
  onFeedbackChanged,
}: WorkbenchDocumentsProps) {
  const { message, modal } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [importingSpec, setImportingSpec] = useState(false);
  const [specEditing, setSpecEditing] = useState(false);
  const [specDraft, setSpecDraft] = useState('');
  const [specRef, setSpecRef] = useState<string>();
  const [specAtContent, setSpecAtContent] = useState<string | null>(null);
  const [specHistoryLoading, setSpecHistoryLoading] = useState(false);
  const [specHistoryError, setSpecHistoryError] = useState('');
  const [changesEditing, setChangesEditing] = useState(false);
  const [changeDraft, setChangeDraft] = useState<ChangeItem[]>([]);
  const [cumFrom, setCumFrom] = useState<string | null>(null);
  const [changeItems, setChangeItems] = useState<ChangeItem[]>([]);
  const [locationCounts, setLocationCounts] = useState<Record<string, number>>({});
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState('');
  const [reqsEditing, setReqsEditing] = useState(false);
  const [reqDraft, setReqDraft] = useState<RequirementLink[]>([]);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [feedbackAction, setFeedbackAction] = useState('');
  const cumulativeRequest = useRef(0);
  const specRequest = useRef(0);
  const routeKey = `${slug}\u0000${versionNo}`;
  const routeKeyRef = useRef(routeKey);
  routeKeyRef.current = routeKey;

  const editable = Boolean(
    canWrite
    && version?.display?.key !== 'VOID'
    && (!lockBaseline || version?.display?.key === 'DRAFT'),
  );
  const documentWritable = Boolean(canWrite && version?.display?.key !== 'VOID');
  const olderVersions = useMemo(
    () => olderSiblings(siblings, versionNo) as any[],
    [siblings, versionNo],
  );
  const olderVersionKey = olderVersions.map((item) => item.versionNo).join('\u0000');
  const versionFeedbacks = useMemo(
    () => filterVersionFeedback(feedbacks, slug, versionNo) as any[],
    [feedbacks, slug, versionNo],
  );
  const tagOptions = useMemo(() => allTags.map((item) => {
    const tag = typeof item === 'string' ? item : item.tag;
    const count = typeof item === 'object' && item ? item.count : undefined;
    return { value: tag, label: count === undefined ? tag : `${tag} (${count})` };
  }).filter((item) => item.value), [allTags]);
  const previewLink = useMemo(() => {
    if (previewUrl) return previewUrl;
    if (typeof window === 'undefined') return '';
    return `${window.location.protocol}//${window.location.hostname}:7789`
      + `/p/${encodeURIComponent(slug)}/${encodeURIComponent(versionNo)}`;
  }, [previewUrl, slug, versionNo]);

  useEffect(() => {
    cumulativeRequest.current += 1;
    specRequest.current += 1;
    setSpecEditing(false);
    setSpecRef(undefined);
    setSpecAtContent(null);
    setSpecHistoryLoading(false);
    setSpecHistoryError('');
    setChangesEditing(false);
    setChangesLoading(false);
    setReqsEditing(false);
    setChangesError('');
    setSaving(false);
    setImportingSpec(false);
    setSavingTags(false);
    setFeedbackAction('');
  }, [slug, versionNo]);

  useEffect(() => {
    if (!specEditing) setSpecDraft(version?.spec || '');
    if (!changesEditing) setChangeDraft((version?.changes || []).map((item: ChangeItem) => ({ ...item })));
    if (!reqsEditing) setReqDraft((version?.requirements || []).map((item: RequirementLink) => ({ ...item })));
    setTagDraft([...(version?.tags || [])]);
  }, [version, specEditing, changesEditing, reqsEditing]);

  useEffect(() => {
    setCumFrom(olderVersions[0]?.versionNo || null);
  }, [slug, versionNo, olderVersionKey]);

  const loadChanges = useCallback(async (from: string | null) => {
    const requestId = ++cumulativeRequest.current;
    setChangesError('');
    if (!from) {
      setChangeItems(version?.changes || []);
      setLocationCounts({});
      setChangesLoading(false);
      return;
    }

    setChangesLoading(true);
    try {
      const result = await api.cumulative(slug, from, versionNo) as CumulativeResult;
      if (requestId !== cumulativeRequest.current) return;
      setChangeItems(result.items || []);
      setLocationCounts(result.locationCounts || {});
    } catch (error) {
      if (requestId !== cumulativeRequest.current) return;
      setChangesError(errorMessage(error, '累计变更读取失败'));
    } finally {
      if (requestId === cumulativeRequest.current) setChangesLoading(false);
    }
  }, [slug, versionNo, version?.changes]);

  useEffect(() => {
    void loadChanges(cumFrom);
  }, [cumFrom, loadChanges]);

  const startSpecEdit = () => {
    if (!documentWritable) {
      message.info(version?.display?.key === 'VOID' ? '已废弃版本不可编辑规格书' : '当前是只读模式，不能编辑规格书');
      return;
    }
    setSpecDraft(version?.spec || '');
    setSpecRef(undefined);
    setSpecAtContent(null);
    setSpecHistoryError('');
    setSpecEditing(true);
  };

  const loadSpecAt = async (ref?: string) => {
    const requestId = ++specRequest.current;
    setSpecRef(ref);
    setSpecHistoryError('');
    if (!ref) {
      setSpecAtContent(null);
      setSpecHistoryLoading(false);
      return;
    }

    setSpecHistoryLoading(true);
    try {
      const result = await api.specAt(slug, versionNo, ref) as { spec?: string };
      if (requestId !== specRequest.current) return;
      setSpecAtContent(result.spec || '');
    } catch (error) {
      if (requestId !== specRequest.current) return;
      setSpecAtContent(null);
      setSpecHistoryError(errorMessage(error, '规格历史读取失败'));
    } finally {
      if (requestId === specRequest.current) setSpecHistoryLoading(false);
    }
  };

  const applyTemplate = () => {
    const replace = () => setSpecDraft(specTemplate(versionNo, version));
    if (!specDraft.trim()) {
      replace();
      return;
    }
    modal.confirm({
      title: '使用规格书模板？',
      content: '当前草稿会被模板覆盖，此操作无法撤销。',
      okText: '覆盖草稿',
      cancelText: '取消',
      onOk: replace,
    });
  };

  const saveSpec = async () => {
    if (!documentWritable) {
      message.info(version?.display?.key === 'VOID' ? '已废弃版本不可编辑规格书' : '当前是只读模式，不能保存规格书');
      return;
    }
    const expectedRoute = routeKey;
    setSaving(true);
    try {
      const nextVersion = await api.setSpec(slug, versionNo, specDraft);
      if (routeKeyRef.current !== expectedRoute) return;
      await onVersionChanged(nextVersion);
      if (routeKeyRef.current !== expectedRoute) return;
      await onSpecHistoryChanged();
      if (routeKeyRef.current !== expectedRoute) return;
      setSpecEditing(false);
      message.success('规格书已保存');
    } catch (error) {
      message.error(errorMessage(error, '规格书保存失败'));
    } finally {
      if (routeKeyRef.current === expectedRoute) setSaving(false);
    }
  };

  const importSpec = async (file: File) => {
    if (!documentWritable) {
      message.info(version?.display?.key === 'VOID' ? '已废弃版本不可上传规格书' : '当前是只读模式，不能上传规格书');
      return false;
    }
    if (file.size > maxFileBytes) {
      message.error(`${file.name} 超过上限 ${fmtSize(maxFileBytes)}`);
      return false;
    }
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      message.error('请上传 Markdown 或文本格式的规格书');
      return false;
    }

    setImportingSpec(true);
    const expectedRoute = routeKey;
    let markdown = '';
    try {
      markdown = await file.text();
      if (routeKeyRef.current !== expectedRoute) return false;
      if (specEditing) {
        setSpecDraft(markdown);
        message.success(`已导入 ${file.name}，保存后生效`);
      } else {
        const nextVersion = await api.setSpec(slug, versionNo, markdown);
        if (routeKeyRef.current !== expectedRoute) return false;
        await onVersionChanged(nextVersion);
        if (routeKeyRef.current !== expectedRoute) return false;
        await onSpecHistoryChanged();
        if (routeKeyRef.current !== expectedRoute) return false;
        message.success(`已上传并保存 ${file.name}`);
      }
    } catch (error) {
      if (routeKeyRef.current !== expectedRoute) return false;
      if (markdown) {
        setSpecDraft(markdown);
        setSpecEditing(true);
        message.error(`${errorMessage(error, `保存 ${file.name} 失败`)}，内容已保留在编辑器中`);
      } else {
        message.error(errorMessage(error, `读取 ${file.name} 失败`));
      }
    } finally {
      if (routeKeyRef.current === expectedRoute) setImportingSpec(false);
    }
    return false;
  };

  const startChangeEdit = () => {
    setChangeDraft((version?.changes || []).map((item: ChangeItem) => ({ ...item })));
    setChangesEditing(true);
  };

  const saveChanges = async () => {
    if (!editable) {
      message.info('只有编辑中版本可以修改变更日志');
      return;
    }
    const items = changeDraft.filter((item) => item.content?.trim());
    const expectedRoute = routeKey;
    setSaving(true);
    try {
      const nextVersion = await api.setChanges(slug, versionNo, items);
      if (routeKeyRef.current !== expectedRoute) return;
      await onVersionChanged(nextVersion);
      if (routeKeyRef.current !== expectedRoute) return;
      setChangesEditing(false);
      if (!cumFrom) {
        setChangeItems((nextVersion as any)?.changes || items);
        setLocationCounts({});
      } else {
        await loadChanges(cumFrom);
        if (routeKeyRef.current !== expectedRoute) return;
      }
      message.success('变更日志已保存');
    } catch (error) {
      message.error(errorMessage(error, '变更日志保存失败'));
    } finally {
      if (routeKeyRef.current === expectedRoute) setSaving(false);
    }
  };

  const startRequirementEdit = () => {
    setReqDraft((version?.requirements || []).map((item: RequirementLink) => ({ ...item })));
    setReqsEditing(true);
  };

  const saveRequirements = async () => {
    if (!editable) {
      message.info('只有编辑中版本可以修改关联需求');
      return;
    }
    const items = reqDraft.filter((item) => item.code?.trim());
    const expectedRoute = routeKey;
    setSaving(true);
    try {
      const nextVersion = await api.setRequirements(slug, versionNo, items);
      if (routeKeyRef.current !== expectedRoute) return;
      await onVersionChanged(nextVersion);
      if (routeKeyRef.current !== expectedRoute) return;
      setReqsEditing(false);
      message.success('关联需求已保存');
    } catch (error) {
      message.error(errorMessage(error, '关联需求保存失败'));
    } finally {
      if (routeKeyRef.current === expectedRoute) setSaving(false);
    }
  };

  const saveTags = async (tags: string[]) => {
    if (!canWrite) {
      message.info('当前是只读模式，不能编辑标签');
      return;
    }
    setTagDraft(tags);
    const expectedRoute = routeKey;
    setSavingTags(true);
    try {
      const nextVersion = await api.setTags(slug, versionNo, tags);
      if (routeKeyRef.current !== expectedRoute) return;
      await onVersionChanged(nextVersion);
      if (routeKeyRef.current !== expectedRoute) return;
      await onTagsChanged();
      if (routeKeyRef.current !== expectedRoute) return;
      message.success('标签已保存');
    } catch (error) {
      if (routeKeyRef.current !== expectedRoute) return;
      message.error(`${errorMessage(error, '标签保存失败')}，当前选择已保留`);
    } finally {
      if (routeKeyRef.current === expectedRoute) setSavingTags(false);
    }
  };

  const submitFeedback = async (item: any) => {
    const expectedRoute = routeKey;
    setFeedbackAction(`submit:${item.id}`);
    try {
      const result = await api.submitFeedback(item.id, {}) as { url?: string; markdown?: string };
      if (routeKeyRef.current !== expectedRoute) return;
      if (result.url) {
        message.success('反馈已提交');
        openWindow(result.url);
      } else if (result.markdown) {
        try {
          await copyText(result.markdown);
          message.success('未配置问题平台，反馈 Markdown 已复制');
        } catch {
          message.warning('反馈 Markdown 已生成，但复制失败');
        }
      } else {
        message.success('反馈已提交');
      }
      await onFeedbackChanged();
      if (routeKeyRef.current !== expectedRoute) return;
    } catch (error) {
      if (routeKeyRef.current !== expectedRoute) return;
      message.error(errorMessage(error, '反馈提交失败，草稿已保留'));
    } finally {
      if (routeKeyRef.current === expectedRoute) setFeedbackAction('');
    }
  };

  const removeFeedback = (item: any) => {
    modal.confirm({
      title: '删除这条标注反馈？',
      content: textOf(item.title, '删除后无法在草稿列表中恢复。'),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const expectedRoute = routeKey;
        setFeedbackAction(`delete:${item.id}`);
        try {
          await api.removeFeedbackDraft(item.id);
          if (routeKeyRef.current !== expectedRoute) return;
          await onFeedbackChanged();
          if (routeKeyRef.current !== expectedRoute) return;
          message.success('标注反馈已删除');
        } catch (error) {
          message.error(errorMessage(error, '标注反馈删除失败'));
          throw error;
        } finally {
          if (routeKeyRef.current === expectedRoute) setFeedbackAction('');
        }
      },
    });
  };

  const specificationPanel = (
    <div style={panelStyle}>
      <div style={toolbarStyle}>
        <Typography.Text type="secondary">
          {version?.specUpdatedAt ? `最后编辑 ${fmtTime(version.specUpdatedAt)}` : '尚未保存规格书'}
        </Typography.Text>
        <div style={{ flex: 1 }} />
        {specCommits.length ? (
          <Select
            allowClear
            aria-label="回看规格书历史"
            disabled={specEditing}
            loading={specHistoryLoading}
            placeholder="回看历史版本"
            style={{ width: 210 }}
            value={specRef}
            options={specCommits.map((commit) => ({
              value: commit.hash,
              label: `${textOf(commit.short || commit.hash)} · ${fmtTime(commit.date)}`,
            }))}
            onChange={loadSpecAt}
          />
        ) : null}
        {!specEditing ? (
            <Button icon={<EditOutlined />} disabled={!documentWritable} onClick={startSpecEdit}>编辑</Button>
        ) : (
          <>
            <Button icon={<FileTextOutlined />} onClick={applyTemplate}>编写模板</Button>
            <Button onClick={() => setSpecEditing(false)}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveSpec}>保存</Button>
          </>
        )}
        {documentWritable ? (
          <Upload
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            beforeUpload={importSpec}
            showUploadList={false}
          >
            <Button icon={<UploadOutlined />} loading={importingSpec}>上传导入</Button>
          </Upload>
        ) : null}
      </div>

      {specHistoryError ? (
        <Alert type="error" showIcon message="规格历史读取失败" description={specHistoryError} style={{ marginBottom: 12 }} />
      ) : null}
      {specRef && specAtContent !== null ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={(
            <Space wrap>
              <span>正在查看 <code>{specRef.slice(0, 7)}</code> 时的内容，非当前版本</span>
              <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => loadSpecAt(undefined)}>
                回到当前
              </Button>
            </Space>
          )}
        />
      ) : null}
      <Alert
        type="info"
        showIcon
        message="规格书是活文档，版本确认后仍可编辑；原型文件与变更日志则按版本状态锁定。"
        style={{ marginBottom: 16 }}
      />

      {specEditing ? (
        <Input.TextArea
          autoSize={{ minRows: 20 }}
          className="fl-mono"
          value={specDraft}
          placeholder="用 Markdown 写清楚这一版的产品规则、接口约束、验收口径和风险说明"
          onChange={(event) => setSpecDraft(event.target.value)}
        />
      ) : specHistoryLoading ? (
        <div style={{ display: 'grid', minHeight: 240, placeItems: 'center' }}><Spin /></div>
      ) : specAtContent !== null ? (
        <div className="fl-spec" dangerouslySetInnerHTML={markdownHtml(specAtContent)} />
      ) : version?.spec ? (
        <div className="fl-spec" dangerouslySetInnerHTML={markdownHtml(version.spec)} />
      ) : (
        <Empty description="本版本尚未编写规格书">
          <Space wrap>
            <Button type="primary" disabled={!documentWritable} onClick={startSpecEdit}>开始编写</Button>
            {documentWritable ? (
              <Upload
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                beforeUpload={importSpec}
                showUploadList={false}
              >
                <Button icon={<UploadOutlined />} loading={importingSpec}>上传规格书</Button>
              </Upload>
            ) : null}
          </Space>
        </Empty>
      )}
    </div>
  );

  const changesPanel = (
    <div style={panelStyle}>
      <div style={toolbarStyle}>
        <Typography.Text type="secondary">对比起点</Typography.Text>
        <Select
          allowClear
          aria-label="累计变更对比起点"
          placeholder="仅看本版"
          style={{ minWidth: 220, flex: '1 1 260px' }}
          value={cumFrom || undefined}
          options={olderVersions.map((item) => ({
            value: item.versionNo,
            label: `${item.versionNo} - ${textOf(item.title, '未命名版本')}`,
          }))}
          onChange={(value) => setCumFrom(value || null)}
        />
        {editable ? (
          changesEditing
            ? <Button onClick={() => setChangesEditing(false)}>取消编辑</Button>
            : <Button icon={<EditOutlined />} onClick={startChangeEdit}>编辑草稿</Button>
        ) : null}
      </div>

      {changesEditing ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <ChangeEditor value={changeDraft} onChange={setChangeDraft} />
          <Button type="primary" block icon={<SaveOutlined />} loading={saving} onClick={saveChanges}>
            保存变更日志
          </Button>
        </Space>
      ) : (
        <>
          {!editable && version ? (
            <Alert
              type="info"
              showIcon
              message={`${textOf(version.display?.label, '当前状态')} · 已锁定`}
              description="如需修改结构性内容，请新建版本或将可恢复版本切回编辑中。"
              style={{ marginBottom: 16 }}
            />
          ) : null}
          {changesError ? (
            <Alert
              type="error"
              showIcon
              message="累计变更读取失败"
              description={changesError}
              action={<Button size="small" onClick={() => loadChanges(cumFrom)}>重试</Button>}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Spin spinning={changesLoading}>
            <ChangeList
              items={changeItems}
              locationCounts={locationCounts}
              showHot={Boolean(cumFrom)}
              onOpenRequirement={(code) => {
                const item = version?.requirements?.find((entry: RequirementLink) => entry.code === code);
                const url = requirementUrl(code, item?.url, requirementUrlTemplate);
                if (url) openWindow(url);
                else message.info(`需求 ${code} 未登记链接`);
              }}
            />
          </Spin>
        </>
      )}
    </div>
  );

  const requirementsPanel = (
    <div style={panelStyle}>
      <div style={toolbarStyle}>
        <Typography.Text type="secondary">本版本关联的业务需求</Typography.Text>
        <div style={{ flex: 1 }} />
        {editable ? (
          reqsEditing
            ? <Button onClick={() => setReqsEditing(false)}>取消编辑</Button>
            : <Button icon={<EditOutlined />} onClick={startRequirementEdit}>编辑草稿</Button>
        ) : null}
      </div>

      {reqsEditing ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <RequirementEditor value={reqDraft} onChange={setReqDraft} />
          <Button type="primary" block icon={<SaveOutlined />} loading={saving} onClick={saveRequirements}>
            保存关联需求
          </Button>
        </Space>
      ) : !version?.requirements?.length ? (
        <Empty description="未关联需求" />
      ) : (
        <List
          className="fl-list-surface"
          dataSource={version.requirements as RequirementLink[]}
          renderItem={(item) => {
            const url = requirementUrl(item.code || '', item.url, requirementUrlTemplate);
            return (
              <List.Item>
                <div style={{ ...itemSurfaceStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Tag color="success" className="fl-mono">{textOf(item.code)}</Tag>
                  <Typography.Text style={{ flex: 1, minWidth: 0 }}>{textOf(item.title, '未填写需求标题')}</Typography.Text>
                  <Button icon={<ExportOutlined />} disabled={!url} onClick={() => openWindow(url)}>打开</Button>
                </div>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );

  const filesPanel = (
    <div style={panelStyle}>
      {version ? (
        <AttachmentsPanel
          slug={slug}
          versionNo={versionNo}
          attachments={version.attachments || []}
          canWrite={documentWritable}
          maxFileBytes={maxFileBytes}
          onChanged={() => onVersionChanged()}
        />
      ) : <Empty description="版本信息尚未加载" />}
    </div>
  );

  const informationPanel = (
    <div style={panelStyle}>
      {version ? (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="版本号"><code>{textOf(version.versionNo)}</code></Descriptions.Item>
          <Descriptions.Item label="标题">{textOf(version.title)}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={version.display?.color || 'default'}>{textOf(version.display?.label, version.status)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="标签">
            <Select
              mode="tags"
              aria-label="版本标签"
              className="fl-full-width"
              disabled={!canWrite || savingTags}
              loading={savingTags}
              maxTagCount="responsive"
              options={tagOptions}
              placeholder="加个标签，比如 已评审 / 已交付"
              value={tagDraft}
              onChange={saveTags}
            />
          </Descriptions.Item>
          <Descriptions.Item label="文件">
            <code>{textOf(version.file)}</code>
            <Typography.Text type="secondary"> · {fmtSize(version.fileSize)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="磁盘路径">
            <code style={{ overflowWrap: 'anywhere' }}>projects/{slug}/versions/{textOf(version.file)}</code>
          </Descriptions.Item>
          <Descriptions.Item label="来源">
            <code style={{ overflowWrap: 'anywhere' }}>{textOf(version.sourcePath)}</code>
          </Descriptions.Item>
          <Descriptions.Item label="外部依赖">
            {version.externalRefs?.length ? (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Tag color="warning">{version.externalRefs.length} 项</Tag>
                {version.externalRefs.map((reference: unknown, index: number) => (
                  <Typography.Text key={`${textOf(reference)}:${index}`} type="secondary" copyable className="fl-mono">
                    {textOf(reference)}
                  </Typography.Text>
                ))}
              </Space>
            ) : '无'}
          </Descriptions.Item>
          <Descriptions.Item label="创建">
            {fmtAbsolute(version.createdAt)} · {textOf(version.createdBy)}
          </Descriptions.Item>
          <Descriptions.Item label="首次成为基线">{fmtAbsolute(version.baselineAt)}</Descriptions.Item>
          <Descriptions.Item label="预览直链">
            <Typography.Text copyable={{ text: previewLink }} className="fl-mono" style={{ overflowWrap: 'anywhere' }}>
              {previewLink}
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      ) : <Empty description="版本信息尚未加载" />}
    </div>
  );

  const feedbackPanel = (
    <div style={panelStyle}>
      <div style={toolbarStyle}>
        <Typography.Text strong>标注反馈草稿</Typography.Text>
        <Tag>{versionFeedbacks.length} 条</Tag>
      </div>
      {!versionFeedbacks.length ? (
        <Empty description="暂无标注反馈" />
      ) : (
        <List
          className="fl-list-surface"
          dataSource={versionFeedbacks}
          renderItem={(item) => (
            <List.Item>
              <article style={itemSurfaceStyle}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <Typography.Text strong style={{ flex: 1, minWidth: 0 }}>{textOf(item.title, '未命名反馈')}</Typography.Text>
                  <Typography.Text type="secondary">{fmtTime(item.createdAt)}</Typography.Text>
                </div>
                <Typography.Paragraph style={{ margin: '8px 0 12px', whiteSpace: 'pre-wrap' }}>
                  {textOf(item.description, '未填写反馈说明')}
                </Typography.Paragraph>
                <Space wrap size={[8, 8]}>
                  {(item.requirements || []).map((code: string) => (
                    <Tag key={code} color="success" className="fl-mono">{code}</Tag>
                  ))}
                  {item.hasScreenshot ? <Tag color="success">含截图</Tag> : null}
                  {item.hasScreenshot ? (
                    <Button type="link" size="small" onClick={() => openWindow(api.feedbackScreenshotUrl(item.id))}>
                      查看截图
                    </Button>
                  ) : null}
                  {item.url ? (
                    <Button type="link" size="small" icon={<ExportOutlined />} onClick={() => openWindow(item.url)}>
                      定位标注
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    type="primary"
                    icon={<SendOutlined />}
                    loading={feedbackAction === `submit:${item.id}`}
                    disabled={Boolean(feedbackAction) && feedbackAction !== `submit:${item.id}`}
                    onClick={() => submitFeedback(item)}
                  >
                    提交反馈
                  </Button>
                  <Button
                    danger
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    loading={feedbackAction === `delete:${item.id}`}
                    disabled={Boolean(feedbackAction) && feedbackAction !== `delete:${item.id}`}
                    onClick={() => removeFeedback(item)}
                  >
                    删除
                  </Button>
                </Space>
              </article>
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <Tabs
      activeKey={activeTab}
      className="fl-workbench-tabs"
      style={{ display: 'flex', minWidth: 0, minHeight: 0, height: '100%', flexDirection: 'column' }}
      tabBarStyle={{ flex: '0 0 auto', margin: 0, padding: '0 var(--fl-s-4)' }}
      items={[
        { key: 'spec', label: '规格书', children: specificationPanel },
        { key: 'changes', label: `变更 ${version?.changeCount ?? version?.changes?.length ?? 0}`, children: changesPanel },
        { key: 'reqs', label: `需求 ${version?.requirementCount ?? version?.requirements?.length ?? 0}`, children: requirementsPanel },
        { key: 'files', label: `附件 ${version?.attachments?.length ?? 0}`, children: filesPanel },
        { key: 'info', label: '版本信息', children: informationPanel },
        { key: 'feedback', label: `反馈 ${versionFeedbacks.length}`, children: feedbackPanel },
      ]}
      onChange={onTabChange}
    />
  );
}
