import {
  ArrowRightOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileUnknownOutlined,
  FileWordOutlined,
  FileZipOutlined,
  FireOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Badge,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Table,
  Tooltip,
  Upload,
} from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { fmtSize, fmtTime } from '@/utils/format';
import { baselineBlocked, groupChanges } from './workbenchModel.js';
import { changesToText, textToChanges, releaseNotesTemplate } from './releaseNotesModel.js';

export type ChangeItem = {
  type?: string;
  location?: string;
  content?: string;
  requirement?: string;
  fromVersionNo?: string;
};

type ChangeGroup = {
  type: string;
  meta: { label: string; color: string };
  items: ChangeItem[];
};

type ChangeListProps = {
  items?: ChangeItem[];
  locationCounts?: Record<string, number>;
  showHot?: boolean;
  onOpenRequirement?: (code: string) => void;
};

export function ChangeList({
  items = [],
  locationCounts = {},
  showHot = false,
  onOpenRequirement,
}: ChangeListProps) {
  const groups = groupChanges(items) as ChangeGroup[];

  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无变更记录" />;
  }

  if (items.every((item) => !item.location && !item.requirement && (!item.type || item.type === 'MODIFY'))) {
    return <div style={primitiveStyles.stack}>{items.map((item, index) => (
      <article key={index}>
        {item.fromVersionNo ? <Tag>{item.fromVersionNo}</Tag> : null}
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8 }}>{item.content}</div>
      </article>
    ))}</div>;
  }

  return (
    <div style={primitiveStyles.stack}>
      {groups.map((group) => (
        <section key={group.type} aria-label={`${group.meta.label}变更`}>
          <div style={primitiveStyles.groupHeader}>
            <Tag color={group.meta.color}>{group.meta.label}</Tag>
            <span style={primitiveStyles.secondaryText}>{group.items.length} 条</span>
          </div>

          <div>
            {group.items.map((item, index) => {
              const locationKey = item.location?.trim() || '未标注位置';
              const hotCount = locationCounts[locationKey] || 0;

              return (
                <article
                  key={`${group.type}-${item.location || ''}-${item.content || ''}-${index}`}
                  style={primitiveStyles.changeItem}
                >
                  {item.location ? <span style={primitiveStyles.location}>{item.location}</span> : null}
                  <div style={primitiveStyles.changeContent}>
                    <div style={primitiveStyles.contentLine}>
                      <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</span>
                      {item.requirement ? (
                        <Button
                          type="link"
                          size="small"
                          disabled={!onOpenRequirement}
                          aria-label={`打开需求 ${item.requirement}`}
                          style={primitiveStyles.inlineLink}
                          onClick={() => onOpenRequirement?.(item.requirement!)}
                        >
                          {item.requirement}
                        </Button>
                      ) : null}
                    </div>
                    {showHot && hotCount > 2 ? (
                      <div style={primitiveStyles.hotNotice}>
                        <FireOutlined aria-hidden />
                        <span>该区域在所选区间内被修改了 {hotCount} 次，建议重点确认</span>
                      </div>
                    ) : null}
                  </div>
                  {item.fromVersionNo ? (
                    <code style={primitiveStyles.versionNo}>{item.fromVersionNo}</code>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

type ChangeEditorProps = {
  value: ChangeItem[];
  onChange: (value: ChangeItem[]) => void;
};

export function ChangeEditor({ value, onChange }: ChangeEditorProps) {
  const text = changesToText(value);
  return (
    <div style={primitiveStyles.editor}>
      <span>发布说明</span>
      <Input.TextArea
        value={text}
        aria-label="变更日志发布说明"
        placeholder={releaseNotesTemplate}
        autoSize={{ minRows: 14, maxRows: 32 }}
        style={{ lineHeight: 1.8 }}
        onChange={(event) => onChange(textToChanges(event.target.value))}
      />
      <div style={primitiveStyles.secondaryText}>可粘贴完整发布说明，保留换行、段落及列表；按新增、优化、修复和注意事项填写。</div>
      <Button disabled={Boolean(text.trim())} onClick={() => onChange(textToChanges(releaseNotesTemplate))}>
        填入标准格式模板
      </Button>
    </div>
  );
}

export type RequirementLink = {
  code?: string;
  title?: string;
  url?: string;
  location?: string;
  scope?: string;
};

type RequirementEditorProps = {
  value: RequirementLink[];
  onChange: (value: RequirementLink[]) => void;
  disabled?: boolean;
};

export function RequirementEditor({ value, onChange, disabled = false }: RequirementEditorProps) {
  const [requirements, setRequirements] = useState<(RequirementLink & { project?: string; status?: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>();
  const [pendingCodes, setPendingCodes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ code: '', title: '', url: '' });
  const [manualError, setManualError] = useState('');
  const selected = value.filter(row => row.code?.trim());
  const selectedCodes = new Set(selected.map(row => row.code!.trim()));
  const projectOptions = [...new Set(requirements.map(item => item.project || ''))].sort()
    .map(project => ({ value: project, label: project || '未分项目' }));
  const matchingRequirements = requirements.filter(item =>
    (projectFilter === undefined || (item.project || '') === projectFilter)
    && `${item.code || ''} ${item.title || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const addPending = () => {
    const additions = requirements.filter(item => pendingCodes.includes(item.code || '') && !selectedCodes.has(item.code || ''))
      .map(({ code, title, url }) => ({ code, title, url }));
    onChange([...selected, ...additions]);
    setPickerOpen(false);
    setPendingCodes([]);
  };

  const addRequirement = (item: RequirementLink) => {
    if (!selected.some(row => row.code?.trim() === item.code)) onChange([...selected, item]);
    setSearch('');
  };

  const addManual = () => {
    const code = manual.code.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code)) {
      setManualError('请填写有效编号：支持字母、数字、点、下划线和短横线，最多 64 位');
      return;
    }
    if (selected.some(row => row.code?.trim() === code)) {
      setManualError('该需求已在已选列表中，无需重复添加');
      return;
    }
    const existing = requirements.find(item => item.code === code);
    if (!existing && !manual.title.trim()) {
      setManualError('请填写需求标题');
      return;
    }
    addRequirement(existing || { code, title: manual.title.trim(), url: manual.url.trim() });
    setManualOpen(false);
    setManual({ code: '', title: '', url: '' });
    setManualError('');
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    api.listRequirements().then((items) => {
      if (active) setRequirements(items);
    }).catch(() => {
      if (active) setLoadError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [retry]);

  return (
    <div style={primitiveStyles.editor}>
      <Button icon={<PlusOutlined />} disabled={disabled} onClick={() => {
        setPendingCodes([]); setSearch(''); setProjectFilter(undefined); setPage(1); setPickerOpen(true);
      }}>选择已有需求</Button>
      <Modal
        title="选择关联需求"
        open={pickerOpen}
        width={960}
        style={{ top: 24 }}
        okText={`添加所选需求（${pendingCodes.length}）`}
        okButtonProps={{ disabled: disabled || !pendingCodes.length || loading || loadError }}
        onOk={addPending}
        onCancel={() => setPickerOpen(false)}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div className="fl-muted">可跨项目批量选择，切换项目和分页会保留勾选；添加后需保存关联需求。</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Select
              aria-label="筛选需求所属项目"
              placeholder="全部项目"
              allowClear showSearch optionFilterProp="label"
              getPopupContainer={trigger => trigger.parentElement!}
              style={{ flex: '1 1 200px', minWidth: 0 }}
              options={projectOptions}
              value={projectFilter}
              onChange={project => { setProjectFilter(project); setPage(1); }}
            />
            <Input.Search
              aria-label="搜索需求编号或标题"
              placeholder="搜索需求编号或标题"
              allowClear value={search}
              style={{ flex: '2 1 240px', minWidth: 0 }}
              onChange={event => { setSearch(event.target.value); setPage(1); }}
            />
          </div>
          {loadError ? <Alert type="error" showIcon message="读取需求失败" action={<Button size="small" onClick={() => setRetry(current => current + 1)}>重试</Button>} /> : null}
          <div aria-live="polite" className="fl-muted">
            匹配 {matchingRequirements.length} 条 · 已关联 {selected.length} 条 · 待添加 {pendingCodes.length} 条
            {pendingCodes.length ? <Button type="link" size="small" onClick={() => setPendingCodes([])}>清空勾选</Button> : null}
          </div>
          <Table
            size="small"
            rowKey="code"
            loading={loading}
            dataSource={matchingRequirements}
            scroll={{ x: 650, y: 'min(320px, 40vh)' }}
            pagination={{ current: page, pageSize: 10, showSizeChanger: false, onChange: setPage }}
            locale={{ emptyText: '没有匹配的需求，请调整项目筛选或搜索条件' }}
            rowSelection={{
              selectedRowKeys: pendingCodes,
              preserveSelectedRowKeys: true,
              onChange: keys => setPendingCodes(keys.map(String)),
              getCheckboxProps: item => ({ disabled: disabled || selectedCodes.has(item.code || ''), 'aria-label': `选择需求 ${item.code}` }),
            }}
            columns={[
              { title: '需求编号', dataIndex: 'code', width: 190 },
              { title: '需求标题', dataIndex: 'title', render: title => title || '未填写标题' },
              { title: '所属项目', dataIndex: 'project', width: 140, render: project => project || '未分项目' },
              { title: '关联状态', width: 100, render: (_, item) => selectedCodes.has(item.code || '') ? <Tag>已关联</Tag> : <span className="fl-muted">未关联</span> },
            ]}
          />
        </Space>
      </Modal>
      {loadError ? <Alert type="error" showIcon message="读取需求失败" action={<Button size="small" onClick={() => setRetry(current => current + 1)}>重试</Button>} /> : null}
      <div className="fl-muted" aria-live="polite">已选 {selected.length} 条 · 保存后生效，移除仅解除本版本关联</div>
      {selected.length ? selected.map((row, index) => (
        <div key={`${row.code}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--fl-line)', padding: '12px 0' }}>
          <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <div className="fl-mono fl-muted">{row.code} · {requirements.find(item => item.code === row.code)?.project || '未分项目'}</div>
            <strong>{row.title || row.code}</strong>
          </div>
          <Button type="text" disabled={disabled} aria-label={`移除需求 ${row.code}`} onClick={() => onChange(selected.filter((_, rowIndex) => rowIndex !== index))}>移除</Button>
        </div>
      )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择需求，请点击上方按钮批量添加" />}
      <Button type="link" disabled={disabled} style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => { setManualOpen(true); setManualError(''); }}>找不到需求？手动录入</Button>
      <Modal title="手动录入需求" open={manualOpen} okText="添加到已选列表" onOk={addManual} onCancel={() => setManualOpen(false)}>
        <p className="fl-muted">已有编号将关联原需求；新编号会在保存版本关联时创建到需求模块。</p>
        <div style={primitiveStyles.editor}>
          <label>需求编号（必填）<Input aria-label="手动录入需求编号" value={manual.code} maxLength={64} onChange={event => setManual({ ...manual, code: event.target.value })} /></label>
          <label>需求标题（新需求必填）<Input aria-label="手动录入需求标题" value={manual.title} maxLength={120} onChange={event => setManual({ ...manual, title: event.target.value })} /></label>
          <label>外部资料链接（选填）<Input aria-label="手动录入需求链接" value={manual.url} onChange={event => setManual({ ...manual, url: event.target.value })} /></label>
          {manualError ? <Alert type="error" showIcon message={manualError} /> : null}
        </div>
      </Modal>
    </div>
  );
}

const reviewOptions = [
  { value: 'pending', label: '待评审' },
  { value: 'confirmed', label: '已确认' },
  { value: 'questions', label: '有疑问' },
];

const reviewBadges = {
  pending: 'warning',
  confirmed: 'success',
  questions: 'error',
} as const;

type ReviewStatusControlProps = {
  slug: string;
  versionNo: string;
  status?: string;
  disabled?: boolean;
  onChanged?: (version: unknown) => void | Promise<void>;
};

export function ReviewStatusControl({
  slug,
  versionNo,
  status,
  disabled = false,
  onChanged,
}: ReviewStatusControlProps) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const obsolete = status === 'obsolete';

  const updateStatus = async (nextStatus: string) => {
    setSaving(true);
    try {
      const version = await api.setReviewStatus(slug, versionNo, nextStatus);
      message.success('审阅状态已更新');
      await onChanged?.(version);
    } catch (error) {
      message.error(errorMessage(error, '更新审阅状态失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select
      size="small"
      value={obsolete ? undefined : status}
      placeholder={obsolete ? '已废弃' : '选择状态'}
      disabled={disabled || obsolete || saving}
      loading={saving}
      aria-label="审阅状态"
      style={primitiveStyles.reviewSelect}
      options={reviewOptions.map((option) => ({
        ...option,
        label: <Badge status={reviewBadges[option.value as keyof typeof reviewBadges]} text={option.label} />,
      }))}
      onChange={(nextStatus) => void updateStatus(nextStatus)}
    />
  );
}

export type BaselineTarget = {
  versionNo: string;
  changeCount?: number;
  changes?: ChangeItem[];
  baselineAt?: string | null;
};

type BaselineModalProps = {
  open: boolean;
  slug: string;
  target?: BaselineTarget | null;
  current?: string | null;
  totalVersions?: number;
  requireChangelog?: boolean;
  onClose: () => void;
  onDone?: (version: unknown) => void | Promise<void>;
};

export function BaselineModal({
  open,
  slug,
  target,
  current,
  totalVersions = 0,
  requireChangelog = true,
  onClose,
  onDone,
}: BaselineModalProps) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const blocked = baselineBlocked({ target, totalVersions, requireChangelog });

  const submit = async () => {
    if (!target || blocked) return;
    setSaving(true);
    try {
      const version = await api.setBaseline(slug, target.versionNo);
      const nextVersionNo = (version as { versionNo?: string } | null)?.versionNo || target.versionNo;
      message.success(`当前基线：${nextVersionNo}`);
      onClose();
      await onDone?.(version);
    } catch (error) {
      message.error(errorMessage(error, '切换基线失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={(
        <Space size="small">
          <ExclamationCircleOutlined style={primitiveStyles.warningIcon} />
          <span>设为当前基线</span>
        </Space>
      )}
      okText="确认切换"
      cancelText="取消"
      confirmLoading={saving}
      closable={!saving}
      cancelButtonProps={{ disabled: saving }}
      okButtonProps={{ disabled: !target || blocked }}
      onCancel={() => {
        if (!saving) onClose();
      }}
      onOk={() => void submit()}
    >
      {target ? (
        <div style={primitiveStyles.modalBody}>
          {blocked ? (
            <Alert
              type="error"
              showIcon
              message="无法切换：变更日志为空"
              description="设为基线前至少要有 1 条变更说明，否则研发无法判断本版改动。请先到工作台的「变更日志」补充。"
            />
          ) : null}

          <div style={primitiveStyles.baselineComparison}>
            <div style={primitiveStyles.baselineVersion}>
              <span style={primitiveStyles.secondaryText}>当前基线</span>
              <strong style={primitiveStyles.baselineNumber}>{current || '无'}</strong>
              {current ? <Tag>将降为「历史版本」</Tag> : null}
            </div>
            <ArrowRightOutlined aria-hidden style={primitiveStyles.baselineArrow} />
            <div style={primitiveStyles.baselineVersion}>
              <span style={primitiveStyles.secondaryText}>新基线</span>
              <strong style={primitiveStyles.targetBaselineNumber}>{target.versionNo}</strong>
              <Tag color="success">研发默认看到此版</Tag>
            </div>
          </div>

          <ul style={primitiveStyles.baselineNotes}>
            <li>切换后打开本项目默认落在 <strong>{target.versionNo}</strong>。</li>
            <li>该版本的原型文件与变更日志将被<strong>锁定</strong>，技术规格说明书仍可编辑。</li>
            {current ? <li>可在项目时间线或功能台里一键退回 {current}。</li> : null}
          </ul>
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择目标版本" />
      )}
    </Modal>
  );
}

export type AttachmentItem = {
  name: string;
  size?: number | null;
  addedBy?: string | null;
  addedAt?: string | number | Date | null;
  missing?: boolean;
};

type AttachmentsPanelProps = {
  slug: string;
  versionNo: string;
  attachments?: AttachmentItem[];
  canWrite: boolean;
  maxFileBytes: number;
  onChanged?: () => void | Promise<void>;
};

export function AttachmentsPanel({
  slug,
  versionNo,
  attachments = [],
  canWrite,
  maxFileBytes,
  onChanged,
}: AttachmentsPanelProps) {
  const { message, modal } = App.useApp();
  const [pendingUploads, setPendingUploads] = useState(0);
  const uploading = pendingUploads > 0;

  const uploadFile = async (file: File) => {
    setPendingUploads((count) => count + 1);
    try {
      await api.addAttachment(slug, versionNo, file);
      message.success(`已上传 ${file.name}`);
      await onChanged?.();
    } catch (error) {
      message.error(errorMessage(error, `上传 ${file.name} 失败`));
    } finally {
      setPendingUploads((count) => Math.max(0, count - 1));
    }
  };

  const beforeUpload = (file: File) => {
    if (maxFileBytes > 0 && file.size > maxFileBytes) {
      message.error(`${file.name} 超过上限 ${fmtSize(maxFileBytes)}`);
      return Upload.LIST_IGNORE;
    }
    void uploadFile(file);
    return false;
  };

  const openAttachment = (attachment: AttachmentItem, download = false) => {
    if (attachment.missing) return;
    window.open(
      api.attachmentUrl(slug, versionNo, attachment.name, download),
      '_blank',
      'noopener,noreferrer',
    );
  };

  const removeAttachment = (attachment: AttachmentItem) => {
    modal.confirm({
      title: `删除附件 ${attachment.name}？`,
      content: '文件会从磁盘删除。已提交到 Git 的历史版本仍能找回。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.removeAttachment(slug, versionNo, attachment.name);
          message.success('已删除');
          await onChanged?.();
        } catch (error) {
          message.error(errorMessage(error, `删除 ${attachment.name} 失败`));
          throw error;
        }
      },
    });
  };

  return (
    <div>
      <div style={primitiveStyles.attachmentsToolbar}>
        <span style={primitiveStyles.secondaryText}>
          PRD、设计稿、评审纪要都可以挂在这里，随 Git 一起提交给团队
        </span>
        {canWrite ? (
          <Upload
            multiple
            showUploadList={false}
            beforeUpload={beforeUpload}
          >
            <Button size="small" icon={<UploadOutlined />} loading={uploading}>
              上传附件
            </Button>
          </Upload>
        ) : null}
      </div>

      {attachments.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有附件" />
      ) : (
        <div style={primitiveStyles.attachmentList}>
          {attachments.map((attachment) => (
            <article key={attachment.name} style={primitiveStyles.attachmentRow}>
              <span aria-hidden style={primitiveStyles.fileIcon}>
                {attachmentIcon(attachment.name)}
              </span>
              <div style={primitiveStyles.attachmentDetails}>
                <div style={primitiveStyles.attachmentName}>
                  <span>{attachment.name}</span>
                  {attachment.missing ? <Tag color="error">文件缺失</Tag> : null}
                </div>
                <span style={primitiveStyles.secondaryText}>
                  {fmtSize(attachment.size)} · {attachment.addedBy || '-'} · {fmtTime(attachment.addedAt)}
                </span>
              </div>
              <Space size="small" style={primitiveStyles.attachmentActions}>
                <Tooltip title="打开附件">
                  <span>
                    <Button
                      size="small"
                      icon={<FolderOpenOutlined />}
                      disabled={attachment.missing}
                      aria-label={`打开附件 ${attachment.name}`}
                      onClick={() => openAttachment(attachment)}
                    />
                  </span>
                </Tooltip>
                <Tooltip title="下载附件">
                  <span>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      disabled={attachment.missing}
                      aria-label={`下载附件 ${attachment.name}`}
                      onClick={() => openAttachment(attachment, true)}
                    />
                  </span>
                </Tooltip>
                {canWrite ? (
                  <Tooltip title="删除附件">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`删除附件 ${attachment.name}`}
                      onClick={() => removeAttachment(attachment)}
                    />
                  </Tooltip>
                ) : null}
              </Space>
            </article>
          ))}
        </div>
      )}

      {attachments.length > 0 ? (
        <div style={primitiveStyles.storagePath}>
          存放位置：
          <code>projects/{slug}/versions/{versionNo}.files/</code>
        </div>
      ) : null}
    </div>
  );
}

function attachmentIcon(name: string): ReactNode {
  const extension = name.split('.').pop()?.toLowerCase() || '';

  if (extension === 'pdf') return <FilePdfOutlined />;
  if (['doc', 'docx'].includes(extension)) return <FileWordOutlined />;
  if (['xls', 'xlsx'].includes(extension)) return <FileExcelOutlined />;
  if (['ppt', 'pptx'].includes(extension)) return <FilePptOutlined />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return <FileImageOutlined />;
  if (extension === 'md') return <FileMarkdownOutlined />;
  if (extension === 'txt') return <FileTextOutlined />;
  if (extension === 'zip') return <FileZipOutlined />;
  return <FileUnknownOutlined />;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message && error.message !== 'NETWORK'
    ? error.message
    : fallback;
}

const primitiveStyles: Record<string, CSSProperties> = {
  stack: {
    display: 'grid',
    gap: 'var(--fl-s-4)',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--fl-s-2)',
    marginBottom: 'var(--fl-s-2)',
  },
  secondaryText: {
    color: 'var(--fl-text-2)',
    fontSize: 'var(--fl-fs-2)',
    lineHeight: 1.5,
  },
  changeItem: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'flex-start',
    gap: 'var(--fl-s-3)',
    padding: 'var(--fl-s-3) 0',
    borderTop: '1px solid var(--fl-line)',
  },
  location: {
    flex: '0 1 auto',
    maxWidth: '32%',
    overflow: 'hidden',
    padding: 'var(--fl-s-1) var(--fl-s-2)',
    borderRadius: 'var(--fl-r-1)',
    background: 'var(--fl-primary-bg)',
    color: 'var(--fl-primary-deep)',
    fontSize: 'var(--fl-fs-2)',
    lineHeight: 1.5,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  changeContent: {
    minWidth: 0,
    flex: 1,
    color: 'var(--fl-text)',
    fontSize: 'var(--fl-fs-3)',
  },
  contentLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 'var(--fl-s-1)',
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
  },
  inlineLink: {
    height: 'auto',
    padding: 0,
    fontSize: 'var(--fl-fs-2)',
  },
  hotNotice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--fl-s-1)',
    marginTop: 'var(--fl-s-2)',
    color: 'var(--pw-color-warning)',
    fontSize: 'var(--fl-fs-2)',
    lineHeight: 1.5,
  },
  versionNo: {
    flex: '0 0 auto',
    color: 'var(--fl-text-2)',
    fontFamily: 'var(--pw-font-family-mono)',
    fontSize: 'var(--fl-fs-1)',
    whiteSpace: 'nowrap',
  },
  editor: {
    display: 'grid',
    gap: 'var(--fl-s-2)',
  },
  requirementIdInput: {
    width: 160,
    flex: '1 1 150px',
    fontFamily: 'var(--pw-font-family-mono)',
  },
  requirementUrlInput: {
    width: 230,
    flex: '2 1 220px',
  },
  iconButton: {
    width: 32,
    flex: '0 0 32px',
  },
  reviewSelect: {
    width: 120,
  },
  warningIcon: {
    color: 'var(--pw-color-warning)',
  },
  modalBody: {
    display: 'grid',
    gap: 'var(--fl-s-4)',
  },
  baselineComparison: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
    alignItems: 'center',
    gap: 'var(--fl-s-3)',
    padding: 'var(--fl-s-4)',
    border: '1px solid var(--fl-line)',
    borderRadius: 'var(--fl-r-3)',
    background: 'var(--pw-color-surface-muted)',
  },
  baselineVersion: {
    display: 'grid',
    minWidth: 0,
    justifyItems: 'center',
    gap: 'var(--fl-s-1)',
    textAlign: 'center',
  },
  baselineNumber: {
    maxWidth: '100%',
    overflow: 'hidden',
    color: 'var(--fl-ink)',
    fontFamily: 'var(--pw-font-family-mono)',
    fontSize: 'var(--fl-fs-5)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  targetBaselineNumber: {
    maxWidth: '100%',
    overflow: 'hidden',
    color: 'var(--fl-primary)',
    fontFamily: 'var(--pw-font-family-mono)',
    fontSize: 'var(--fl-fs-5)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  baselineArrow: {
    color: 'var(--fl-text-3)',
  },
  baselineNotes: {
    display: 'grid',
    gap: 'var(--fl-s-1)',
    margin: 0,
    paddingInlineStart: 'var(--fl-s-5)',
    color: 'var(--fl-text-2)',
    fontSize: 'var(--fl-fs-3)',
    lineHeight: 1.7,
  },
  attachmentsToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 'var(--fl-s-3)',
    marginBottom: 'var(--fl-s-3)',
  },
  attachmentList: {
    display: 'grid',
    gap: 'var(--fl-s-2)',
  },
  attachmentRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 'var(--fl-s-3)',
    padding: 'var(--fl-s-2) var(--fl-s-3)',
    border: '1px solid var(--fl-line)',
    borderRadius: 'var(--fl-r-2)',
    background: 'var(--fl-surface)',
  },
  fileIcon: {
    flex: '0 0 auto',
    color: 'var(--fl-primary)',
    fontSize: 'var(--fl-fs-5)',
    lineHeight: 1,
  },
  attachmentDetails: {
    display: 'grid',
    minWidth: 0,
    flex: 1,
    gap: 'var(--fl-s-1)',
  },
  attachmentName: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--fl-s-2)',
    color: 'var(--fl-text)',
    fontSize: 'var(--fl-fs-3)',
    overflowWrap: 'anywhere',
  },
  attachmentActions: {
    flex: '0 0 auto',
  },
  storagePath: {
    marginTop: 'var(--fl-s-3)',
    color: 'var(--fl-text-2)',
    fontSize: 'var(--fl-fs-2)',
    overflowWrap: 'anywhere',
  },
};
