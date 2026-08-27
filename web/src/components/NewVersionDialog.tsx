import {
  CheckCircleFilled,
  CloudDownloadOutlined,
  CopyOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Result,
  Row,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import {
  ChangeEditor,
  RequirementEditor,
  type ChangeItem,
  type RequirementLink,
} from '@/pages/workbench/WorkbenchPrimitives';
import {
  applySuggestion,
  buildBatchQueue,
  nextVersionSuggestion,
  queueResultSummary,
  reusableMetadata,
  reviewMarkdown,
  sourceSummary,
  validateHtmlFile,
  formatBytes,
} from './newVersionModel.js';

const { Dragger } = Upload;
const { TextArea } = Input;

type SourceMode = 'file' | 'paste' | 'url';

type HtmlInspection = {
  title?: unknown;
  externalRefs?: unknown[];
};

type HtmlImport = HtmlInspection & {
  html?: unknown;
  sourceUrl?: unknown;
};

type NewVersionForm = {
  project?: string;
  versionNo?: string;
  title?: string;
};

type BatchItem = {
  id: string;
  file: File;
  name: string;
  title: string;
  versionNo: string;
  suggestedVersionNo: string;
  html?: string;
  externalRefs?: string[];
  changeText?: string;
  error: string;
  status: 'pending' | 'creating' | 'created' | 'failed';
};

type PublishResult = {
  project: string;
  projectName: string;
  versionNo: string;
  title: string;
  changes: ChangeItem[];
  changeCount: number;
  requirementCount: number;
  externalRefCount: number;
  baselineVersionNo: string;
  path: string;
  gitState: 'local' | 'syncing' | 'synced' | 'failed';
  syncError?: string;
};

export type NewVersionDialogProps = {
  open: boolean;
  slug?: string;
  projects?: any[];
  maxFileBytes: number;
  onClose: () => void;
  onCreated: (project: string, versionNo: string) => void;
};

function externalRefsOf(result: HtmlInspection) {
  return Array.isArray(result.externalRefs) ? result.externalRefs.map(String) : [];
}

export function NewVersionDialog({
  open,
  slug,
  projects = [],
  maxFileBytes,
  onClose,
  onCreated,
}: NewVersionDialogProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<NewVersionForm>();
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [requirements, setRequirements] = useState<RequirementLink[]>([]);
  const [mode, setMode] = useState<SourceMode>('file');
  const [fileName, setFileName] = useState('');
  const [fileDraft, setFileDraft] = useState('');
  const [pastedHtml, setPastedHtml] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [html, setHtml] = useState('');
  const [externalRefs, setExternalRefs] = useState<string[]>([]);
  const [refsOpen, setRefsOpen] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactChecked, setImpactChecked] = useState(false);
  const [impacts, setImpacts] = useState<any[]>([]);
  const [projectDetail, setProjectDetail] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionTouched, setVersionTouched] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [preflight, setPreflight] = useState<any>(null);
  const [warningConfirmed, setWarningConfirmed] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([]);
  const [batchSyncing, setBatchSyncing] = useState(false);

  const resetSource = () => {
    setFileName('');
    setFileDraft('');
    setPastedHtml('');
    setSourceUrl('');
    setHtml('');
    setExternalRefs([]);
    setRefsOpen(false);
    setSourceError('');
    setImpacts([]);
    setImpactChecked(false);
    setPreflight(null);
    setWarningConfirmed(false);
    setBatchQueue([]);
  };

  const loadProjectContext = async (projectSlug: string) => {
    if (!projectSlug) {
      setProjectDetail(null);
      setVersions([]);
      return;
    }
    try {
      const [nextProject, nextVersions] = await Promise.all([
        api.getProject(projectSlug),
        api.listVersions(projectSlug, { includeDraft: true, includeVoid: true }),
      ]);
      setProjectDetail(nextProject);
      setVersions(nextVersions);
    } catch (error) {
      message.error(errorText(error, '无法读取项目版本上下文'));
      setProjectDetail(null);
      setVersions([]);
    }
  };

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ project: slug || undefined });
    setChanges([]);
    setRequirements([]);
    setMode('file');
    setVersionTouched(false);
    setTitleTouched(false);
    setPublishResult(null);
    setBatchSyncing(false);
    resetSource();
    void loadProjectContext(slug || '');
  }, [form, open, slug]);

  const acceptHtml = async (value: string, name = '') => {
    const result = await api.inspectHtml(value) as HtmlInspection;
    setHtml(value);
    setExternalRefs(externalRefsOf(result));
    setSourceError('');

    const suggestedVersionNo = nextVersionSuggestion(versions, name);
    form.setFieldValue('versionNo', applySuggestion(
      form.getFieldValue('versionNo'), suggestedVersionNo, versionTouched,
    ));
    form.setFieldValue('title', applySuggestion(
      form.getFieldValue('title'), String(result.title || name.replace(/\.html?$/i, '')), titleTouched,
    ));
    setPreflight(null);
    setWarningConfirmed(false);
    return value;
  };

  const inspectFileDraft = async (value = fileDraft, name = fileName) => {
    if (!value) return '';
    setImporting(true);
    try {
      return await acceptHtml(value, name);
    } catch (error) {
      const nextError = errorText(error, '读取文件失败');
      setHtml('');
      setExternalRefs([]);
      setSourceError(nextError);
      message.error(nextError);
      return '';
    } finally {
      setImporting(false);
    }
  };

  const importFile = async (file: File) => {
    const validationError = validateHtmlFile(file, maxFileBytes);
    if (validationError) {
      setSourceError(validationError);
      message.error(validationError);
      return;
    }

    setImporting(true);
    setSourceError('');
    setHtml('');
    setExternalRefs([]);
    try {
      const value = await file.text();
      setFileName(file.name);
      setFileDraft(value);
      await acceptHtml(value, file.name);
    } catch (error) {
      const nextError = errorText(error, `读取 ${file.name} 失败`);
      setSourceError(nextError);
      message.error(nextError);
    } finally {
      setImporting(false);
    }
  };

  const inspectPasted = async () => {
    const value = pastedHtml.trim();
    if (!value) {
      setHtml('');
      setExternalRefs([]);
      return '';
    }
    setImporting(true);
    try {
      return await acceptHtml(pastedHtml, '粘贴原型.html');
    } catch (error) {
      const nextError = errorText(error, '检查 HTML 源码失败');
      setHtml('');
      setExternalRefs([]);
      setSourceError(nextError);
      message.error(nextError);
      return '';
    } finally {
      setImporting(false);
    }
  };

  const loadUrl = async () => {
    const url = sourceUrl.trim();
    if (!url) {
      setSourceError('请输入公开 URL');
      message.warning('请输入公开 URL');
      return;
    }

    setImporting(true);
    setSourceError('');
    setHtml('');
    setExternalRefs([]);
    try {
      const result = await api.importUrl(url) as HtmlImport;
      const value = String(result.html || '');
      if (!value.trim()) throw new Error('远端地址未返回 HTML');
      setHtml(value);
      setExternalRefs(externalRefsOf(result));
      let sourceName = url;
      try {
        sourceName = new URL(String(result.sourceUrl || url)).pathname;
      } catch {
        // 保留原 URL 作为版本号推断输入。
      }
      form.setFieldValue('title', applySuggestion(
        form.getFieldValue('title'), String(result.title || '导入原型'), titleTouched,
      ));
      form.setFieldValue('versionNo', applySuggestion(
        form.getFieldValue('versionNo'), nextVersionSuggestion(versions, sourceName), versionTouched,
      ));
      setPreflight(null);
      setWarningConfirmed(false);
    } catch (error) {
      const nextError = errorText(error, '读取 URL 失败');
      setSourceError(nextError);
      message.error(nextError);
    } finally {
      setImporting(false);
    }
  };

  const changeMode = (value: string | number) => {
    setMode(value as SourceMode);
    resetSource();
  };

  const updateChanges = (value: ChangeItem[]) => {
    setChanges(value);
    setImpacts([]);
    setImpactChecked(false);
    setPreflight(null);
    setWarningConfirmed(false);
  };

  const checkImpact = async () => {
    setImpactLoading(true);
    try {
      setImpacts(await api.suggestImpact(changes) as any[]);
      setImpactChecked(true);
    } catch (error) {
      message.error(errorText(error, '无法检查影响面'));
    } finally {
      setImpactLoading(false);
    }
  };

  const prepareBatch = async (files: File[]) => {
    const base = buildBatchQueue(files, {
      maxBytes: maxFileBytes,
      existingVersionNos: versions.map((item) => String(item.versionNo || item.no || '')),
    }) as BatchItem[];
    setBatchQueue(base);
    setImporting(true);
    setPreflight(null);
    setWarningConfirmed(false);
    try {
      const inspected = await Promise.all(base.map(async (item) => {
        if (validateHtmlFile(item.file, maxFileBytes)) return item;
        try {
          const value = await item.file.text();
          const inspection = await api.inspectHtml(value) as HtmlInspection;
          return {
            ...item,
            html: value,
            title: String(inspection.title || item.title),
            externalRefs: externalRefsOf(inspection),
            status: item.error ? 'failed' as const : 'pending' as const,
          };
        } catch (error) {
          return { ...item, status: 'failed' as const, error: errorText(error, `读取 ${item.name} 失败`) };
        }
      }));
      setBatchQueue(inspected);
    } finally {
      setImporting(false);
    }
  };

  const updateBatchItem = (id: string, patch: Partial<BatchItem>) => {
    setBatchQueue((items) => items.map((item) => item.id === id
      ? { ...item, ...patch, status: item.html ? 'pending' : item.status, error: item.html ? '' : item.error }
      : item));
    setPreflight(null);
    setWarningConfirmed(false);
  };

  const reuseLatest = () => {
    const latest = versions.find((item) => item.status !== 'VOID');
    if (!latest) return;
    const reusable = reusableMetadata(latest);
    setRequirements(reusable.requirements);
    if (!changes.length && reusable.locations.length) {
      setChanges([{ type: 'MODIFY', location: reusable.locations[0], content: '' }]);
    }
    setPreflight(null);
    setWarningConfirmed(false);
    message.success('已参考上一版的需求和常用变更位置');
  };

  const setBlockerFields = (blockers: any[]) => {
    const versionError = blockers.find((item) => item.field === 'versionNo')?.message;
    const titleError = blockers.find((item) => item.field === 'title')?.message;
    form.setFields([
      { name: 'versionNo', errors: versionError ? [versionError] : [] },
      { name: 'title', errors: titleError ? [titleError] : [] },
    ]);
    const sourceBlocker = blockers.find((item) => item.field === 'html');
    if (sourceBlocker) setSourceError(sourceBlocker.message);
  };

  const submitBatch = async (project: string) => {
    const candidates = batchQueue.filter((item) => item.status !== 'created');
    if (!candidates.length) return;
    setSaving(true);
    try {
      const checks = await Promise.all(candidates.map(async (item) => {
        if (!item.html) return {
          item,
          check: { ready: false, blockers: [{ message: item.error || '文件未成功读取' }], warnings: [] },
        };
        const itemChanges = item.changeText?.trim()
          ? [{ type: 'MODIFY', location: '', content: item.changeText.trim() }]
          : [];
        const check = await api.preflightVersion(project, {
          html: item.html,
          versionNo: item.versionNo,
          title: item.title,
          changes: itemChanges,
          requirements,
        });
        return { item: { ...item, changes: itemChanges }, check };
      }));
      const warnings = checks.flatMap(({ item, check }) => (check.warnings || []).map((warning: any) => ({
        ...warning, message: `${item.name}：${warning.message}`,
      })));
      const checkedQueue = batchQueue.map((original) => {
        const found = checks.find(({ item }) => item.id === original.id);
        if (!found || found.check.ready) return original;
        return {
          ...original,
          status: 'failed' as const,
          error: found.check.blockers.map((item: any) => item.message).join('；'),
        };
      });
      setBatchQueue(checkedQueue);
      setPreflight({
        ready: checks.every(({ check }) => check.ready),
        blockers: checks.flatMap(({ item, check }) => (check.blockers || []).map((blocker: any) => ({
          ...blocker, message: `${item.name}：${blocker.message}`,
        }))),
        warnings,
      });
      if (!checks.some(({ check }) => check.ready)) return;
      if (warnings.length && !warningConfirmed) return;

      let results = checkedQueue;
      for (const { item, check } of checks) {
        if (!check.ready) continue;
        results = results.map((current) => current.id === item.id ? { ...current, status: 'creating' } : current);
        setBatchQueue(results);
        try {
          const created: any = await api.addVersion(project, {
            versionNo: item.versionNo,
            title: item.title,
            html: item.html,
            changes: (item as any).changes,
            requirements: requirements.filter((requirement) => requirement.code?.trim()),
          });
          results = results.map((current) => current.id === item.id ? {
            ...current,
            status: 'created',
            error: '',
            versionNo: created.versionNo,
          } : current);
        } catch (error) {
          results = results.map((current) => current.id === item.id ? {
            ...current,
            status: 'failed',
            error: errorText(error, '创建失败'),
          } : current);
        }
        setBatchQueue(results);
      }
      const summary = queueResultSummary(results);
      message.success(`批量发布完成：${summary.created} 个成功，${summary.failed} 个失败`);
      await loadProjectContext(project);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (batchQueue.length) {
      let project = String(slug || form.getFieldValue('project') || '').trim();
      if (!project) {
        try {
          const values = await form.validateFields(['project']);
          project = String(values.project || '').trim();
        } catch {
          return;
        }
      }
      await submitBatch(project);
      return;
    }
    let acceptedHtml = html;
    if (mode === 'paste' && pastedHtml.trim() && html !== pastedHtml) {
      acceptedHtml = await inspectPasted();
    }
    if (!acceptedHtml.trim()) {
      const nextError = '请先提供有效的原型 HTML';
      setSourceError(nextError);
      message.warning(nextError);
      return;
    }

    let values: NewVersionForm;
    try {
      values = await form.validateFields();
    } catch (error) {
      const fields = (error as { errorFields?: Array<{ name: Array<string | number> }> }).errorFields;
      if (fields?.[0]) form.scrollToField(fields[0].name, { focus: true });
      return;
    }

    const project = String(slug || values.project || '').trim();
    const versionNo = String(values.versionNo || '').trim();
    const title = String(values.title || '').trim();
    if (!project || !versionNo || !title) return;

    setSaving(true);
    try {
      const cleanChanges = changes.filter((item) => item.content?.trim());
      const cleanRequirements = requirements.filter((item) => item.code?.trim());
      const check: any = await api.preflightVersion(project, {
        versionNo,
        title,
        html: acceptedHtml,
        changes: cleanChanges,
        requirements: cleanRequirements,
      });
      setPreflight(check);
      setBlockerFields(check.blockers || []);
      if (!check.ready) return;
      if (check.warnings?.length && !warningConfirmed) return;

      const created: any = await api.addVersion(project, {
        versionNo,
        title,
        html: acceptedHtml,
        changes: cleanChanges,
        requirements: cleanRequirements,
      });
      message.success(`版本 ${versionNo} 已创建`);
      const path = `/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(versionNo)}`;
      setPublishResult({
        project,
        projectName: projectDetail?.name || projects.find((item) => item.slug === project)?.name || project,
        versionNo,
        title,
        changes: cleanChanges,
        changeCount: created.changeCount ?? cleanChanges.length,
        requirementCount: created.requirementCount ?? cleanRequirements.length,
        externalRefCount: created.externalRefs?.length ?? externalRefs.length,
        baselineVersionNo: projectDetail?.baselineVersionNo || '',
        path,
        gitState: 'local',
      });
      await loadProjectContext(project);
    } catch (error) {
      message.error(errorText(error, '创建版本失败'));
    } finally {
      setSaving(false);
    }
  };

  const copyReview = async (result = publishResult) => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(reviewMarkdown(result));
      message.success('评审摘要已复制');
    } catch (error) {
      message.error(errorText(error, '无法复制评审摘要'));
    }
  };

  const syncPublished = async () => {
    if (!publishResult) return;
    setPublishResult((result) => result ? { ...result, gitState: 'syncing', syncError: '' } : result);
    try {
      await api.gitSync(`feat: 发布 ${publishResult.project}/${publishResult.versionNo}`);
      setPublishResult((result) => result ? { ...result, gitState: 'synced', syncError: '' } : result);
      message.success('已同步到 Git');
    } catch (error) {
      const syncError = errorText(error, 'Git 同步失败');
      setPublishResult((result) => result ? { ...result, gitState: 'failed', syncError } : result);
      message.error(syncError);
    }
  };

  const batchReviewText = () => {
    const project = String(slug || form.getFieldValue('project') || '');
    const projectName = projectDetail?.name || projects.find((item) => item.slug === project)?.name || project;
    return batchQueue.filter((item) => item.status === 'created').map((item) => reviewMarkdown({
      project,
      projectName,
      versionNo: item.versionNo,
      title: item.title,
      baselineVersionNo: projectDetail?.baselineVersionNo || '',
      changes: item.changeText?.trim() ? [{ type: 'MODIFY', location: '', content: item.changeText.trim() }] : [],
      requirementCount: requirements.length,
      path: `/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(item.versionNo)}`,
    })).join('\n---\n\n');
  };

  const copyBatchReview = async () => {
    try {
      await navigator.clipboard.writeText(batchReviewText());
      message.success('批量评审摘要已复制');
    } catch (error) {
      message.error(errorText(error, '无法复制批量评审摘要'));
    }
  };

  const syncBatchPublished = async () => {
    const project = String(slug || form.getFieldValue('project') || '');
    setBatchSyncing(true);
    try {
      await api.gitSync(`feat: 批量发布 ${project} 原型版本`);
      message.success('批量版本已同步到 Git');
    } catch (error) {
      message.error(errorText(error, 'Git 同步失败，已创建版本仍保留在本地'));
    } finally {
      setBatchSyncing(false);
    }
  };

  const firstCreatedBatch = batchQueue.find((item) => item.status === 'created');
  const batchSummary = queueResultSummary(batchQueue);

  const handleOk = () => {
    if (publishResult) return onCreated(publishResult.project, publishResult.versionNo);
    if (batchSummary.pending === 0 && firstCreatedBatch) {
      return onCreated(String(slug || form.getFieldValue('project') || ''), firstCreatedBatch.versionNo);
    }
    void submit();
  };

  return (
    <Modal
      className="fl-new-version-dialog"
      title={publishResult ? '版本已创建' : batchQueue.length ? '批量发布版本' : '新建版本'}
      width={900}
      open={open}
      okText={publishResult
        ? '打开工作台'
        : batchSummary.pending === 0 && firstCreatedBatch
          ? '打开首个版本'
          : batchQueue.length ? '发布队列' : '创建待评审版本'}
      cancelText={publishResult || (batchSummary.pending === 0 && firstCreatedBatch) ? '完成' : '取消'}
      confirmLoading={saving}
      closable={!saving}
      maskClosable={!saving}
      onOk={handleOk}
      onCancel={onClose}
    >
      {publishResult ? (
        <Result
          status="success"
          title={`${publishResult.versionNo} 已创建为待评审版本`}
          subTitle="版本仍处于可编辑状态；评审完成后再单独设置为当前基线。"
          extra={[
            <Button key="copy" icon={<CopyOutlined />} onClick={() => void copyReview()}>
              复制评审摘要
            </Button>,
            <Button
              key="sync"
              icon={<SyncOutlined />}
              loading={publishResult.gitState === 'syncing'}
              onClick={() => void syncPublished()}
            >
              {publishResult.gitState === 'synced' ? '已同步到 Git' : '同步到 Git'}
            </Button>,
          ]}
        >
          <Descriptions className="fl-publish-result-details" bordered size="small" column={2}>
            <Descriptions.Item label="项目">{publishResult.projectName}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color="orange">编辑中 · 待评审</Tag></Descriptions.Item>
            <Descriptions.Item label="版本标题">{publishResult.title}</Descriptions.Item>
            <Descriptions.Item label="当前基线">{publishResult.baselineVersionNo || '未设置'}</Descriptions.Item>
            <Descriptions.Item label="发布内容">
              {publishResult.changeCount} 条变更 · {publishResult.requirementCount} 条需求
            </Descriptions.Item>
            <Descriptions.Item label="外部依赖">{publishResult.externalRefCount} 个</Descriptions.Item>
            <Descriptions.Item label="Git 状态" span={2}>
              {publishResult.gitState === 'synced' ? '已同步'
                : publishResult.gitState === 'failed' ? `同步失败：${publishResult.syncError}`
                  : '仅保存在本地，尚未同步'}
            </Descriptions.Item>
          </Descriptions>
        </Result>
      ) : (
        <>
      <Alert
        className="fl-new-version-intro"
        type="info"
        showIcon
        message="新版本创建后处于编辑中；可以从文件、HTML 源码或公开 URL 导入。"
      />

      <Form form={form} layout="vertical">
        {!slug ? (
          <Form.Item name="project" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择项目"
              options={projects.map((item) => ({
                value: item.slug,
                label: `${item.name || item.slug} · ${item.slug}`,
              }))}
              onChange={(value) => void loadProjectContext(String(value || ''))}
            />
          </Form.Item>
        ) : null}

        <Form.Item label="原型来源" required>
          <Segmented
            block
            aria-label="原型来源"
            value={mode}
            options={[
              { label: '文件', value: 'file' },
              { label: '粘贴源码', value: 'paste' },
              { label: 'URL', value: 'url' },
            ]}
            onChange={changeMode}
          />
        </Form.Item>

        {mode === 'file' ? (
          <Form.Item label="HTML 文件" required>
            {batchQueue.length ? (
              <div className="fl-publish-queue" aria-label="批量发布队列">
                <div className="fl-publish-queue-head">
                  <strong>{batchQueue.length} 个待处理文件</strong>
                  <span>成功 {batchSummary.created} · 失败 {batchSummary.failed} · 待处理 {batchSummary.pending}</span>
                  {batchSummary.created ? (
                    <Space wrap>
                      <Button size="small" icon={<CopyOutlined />} onClick={() => void copyBatchReview()}>复制摘要</Button>
                      <Button size="small" icon={<SyncOutlined />} loading={batchSyncing} onClick={() => void syncBatchPublished()}>同步 Git</Button>
                    </Space>
                  ) : null}
                  <Button size="small" disabled={saving} onClick={resetSource}>清空队列</Button>
                </div>
                {batchQueue.map((item) => (
                  <div className={`fl-publish-queue-row is-${item.status}`} key={item.id}>
                    <div className="fl-publish-queue-file">
                      <FileTextOutlined aria-hidden />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.html ? sourceSummary(item.html, item.externalRefs) : item.error || '等待读取'}</small>
                      </span>
                    </div>
                    <Input
                      className="fl-mono"
                      aria-label={`${item.name} 版本号`}
                      value={item.versionNo}
                      placeholder="版本号"
                      disabled={item.status === 'creating' || item.status === 'created'}
                      onChange={(event) => updateBatchItem(item.id, { versionNo: event.target.value })}
                    />
                    <Input
                      aria-label={`${item.name} 版本标题`}
                      value={item.title}
                      placeholder="版本标题"
                      disabled={item.status === 'creating' || item.status === 'created'}
                      onChange={(event) => updateBatchItem(item.id, { title: event.target.value })}
                    />
                    <Input
                      aria-label={`${item.name} 变更说明`}
                      value={item.changeText}
                      placeholder="本版主要变更"
                      disabled={item.status === 'creating' || item.status === 'created'}
                      onChange={(event) => updateBatchItem(item.id, { changeText: event.target.value })}
                    />
                    <Tag color={item.status === 'created' ? 'success' : item.status === 'failed' ? 'error' : 'default'}>
                      {item.status === 'created' ? '已创建' : item.status === 'creating' ? '创建中' : item.error ? item.error : '待发布'}
                    </Tag>
                  </div>
                ))}
              </div>
            ) : fileName ? (
              <div className={`fl-new-version-source-ready ${html ? 'is-ready' : 'has-error'}`}>
                {html ? <CheckCircleFilled aria-hidden /> : <FileTextOutlined aria-hidden />}
                <div className="fl-new-version-source-copy">
                  <strong>{fileName}</strong>
                  <span>{html ? sourceSummary(html, externalRefs) : '依赖检查失败，可重新检查或重选文件'}</span>
                </div>
                <Space wrap>
                  {!html && fileDraft ? (
                    <Button size="small" icon={<ReloadOutlined />} loading={importing} onClick={() => void inspectFileDraft()}>
                      重新检查
                    </Button>
                  ) : null}
                  <Button size="small" onClick={resetSource}>重选</Button>
                </Space>
              </div>
            ) : (
              <Dragger
                accept=".html,.htm"
                multiple
                showUploadList={false}
                disabled={importing}
                beforeUpload={(file, fileList) => {
                  if (file.uid === fileList[0]?.uid) {
                    if (fileList.length > 1) void prepareBatch(fileList as unknown as File[]);
                    else void importFile(file);
                  }
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon"><UploadOutlined /></p>
                <p className="ant-upload-text">点击或拖拽一个或多个 HTML 文件到此处</p>
                <p className="ant-upload-hint">仅支持 .html / .htm，上限 {formatBytes(maxFileBytes)}</p>
              </Dragger>
            )}
          </Form.Item>
        ) : null}

        {mode === 'paste' ? (
          <Form.Item label="HTML 源码" required>
            <TextArea
              className="fl-mono fl-new-version-source"
              rows={7}
              aria-label="HTML 源码"
              value={pastedHtml}
              placeholder="粘贴完整 HTML 源码"
              onChange={(event) => {
                setPastedHtml(event.target.value);
                setHtml('');
                setExternalRefs([]);
                setSourceError('');
              }}
              onBlur={() => void inspectPasted()}
            />
            <div className="fl-new-version-source-meta" aria-live="polite">
              {html === pastedHtml ? sourceSummary(html, externalRefs) : pastedHtml ? '依赖待检查' : sourceSummary('', [])}
            </div>
          </Form.Item>
        ) : null}

        {mode === 'url' ? (
          <Form.Item label="公开 URL" required>
            <Space.Compact block className="fl-new-version-url-row">
              <Input
                aria-label="公开 URL"
                value={sourceUrl}
                placeholder="https://example.com/prototype"
                onChange={(event) => {
                  setSourceUrl(event.target.value);
                  setHtml('');
                  setExternalRefs([]);
                  setSourceError('');
                }}
                onPressEnter={() => void loadUrl()}
              />
              <Button icon={<CloudDownloadOutlined />} loading={importing} onClick={() => void loadUrl()}>
                读取
              </Button>
            </Space.Compact>
            <div className="fl-new-version-source-meta">
              服务器会校验 DNS、重定向、响应类型和大小，私网地址会被拒绝。
            </div>
            {html ? (
              <div className="fl-new-version-source-ready is-ready is-compact">
                <CheckCircleFilled aria-hidden />
                <div className="fl-new-version-source-copy">
                  <strong>原型已读取</strong>
                  <span>{sourceSummary(html, externalRefs)}</span>
                </div>
              </div>
            ) : null}
          </Form.Item>
        ) : null}

        {sourceError ? (
          <Alert className="fl-new-version-source-alert" type="error" showIcon message={sourceError} role="alert" />
        ) : null}

        {externalRefs.length ? (
          <Alert
            className="fl-new-version-source-alert"
            type="warning"
            showIcon
            message={`检测到 ${externalRefs.length} 个外部依赖，断网时可能影响样式。`}
            description={(
              <>
                <Button
                  type="link"
                  size="small"
                  className="fl-new-version-refs-toggle"
                  aria-expanded={refsOpen}
                  onClick={() => setRefsOpen((value) => !value)}
                >
                  {refsOpen ? '收起清单' : '查看清单'}
                </Button>
                {refsOpen ? (
                  <ul className="fl-new-version-ref-list">
                    {externalRefs.slice(0, 12).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
              </>
            )}
          />
        ) : null}

        {!batchQueue.length ? (
          <>
        <Row gutter={16}>
          <Col xs={24} sm={8}>
            <Form.Item
              name="versionNo"
              label="版本号"
              help="字母数字与 . _ + -，同项目内唯一"
              rules={[{ required: true, whitespace: true, message: '请填写版本号' }]}
            >
              <Input
                className="fl-mono"
                placeholder="v1.0"
                maxLength={32}
                onChange={() => {
                  setVersionTouched(true);
                  setPreflight(null);
                  setWarningConfirmed(false);
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={16}>
            <Form.Item
              name="title"
              label="版本标题"
              rules={[{ required: true, whitespace: true, message: '请填写版本标题' }]}
            >
              <Input
                placeholder="一句话说明本版主题"
                maxLength={100}
                onChange={() => {
                  setTitleTouched(true);
                  setPreflight(null);
                  setWarningConfirmed(false);
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="变更日志" help="除项目首版外，创建待评审版本至少需要 1 条有效变更">
          <div className="fl-new-version-editor">
            <ChangeEditor value={changes} onChange={updateChanges} />
          </div>
          {changes.some((item) => item.location?.trim()) ? (
            <Button
              className="fl-new-version-impact-button"
              size="small"
              loading={impactLoading}
              onClick={() => void checkImpact()}
            >
              检查影响面
            </Button>
          ) : null}
        </Form.Item>

        {impacts.length ? (
          <Alert
            className="fl-new-version-source-alert"
            type="warning"
            showIcon
            message={`发现 ${impacts.length} 条历史关联`}
            description={(
              <div className="fl-new-version-impact-list">
                {impacts.map((item, index) => (
                  <div className="fl-new-version-impact-row" key={`${item.location || 'impact'}-${index}`}>
                    <span>{item.location || '未标注位置'}</span>
                    <span className="fl-mono">{item.source?.project || '-'}/{item.source?.versionNo || '-'}</span>
                    <span>{Array.isArray(item.requirements) && item.requirements.length ? item.requirements.join(', ') : '无需求号'}</span>
                  </div>
                ))}
              </div>
            )}
          />
        ) : impactChecked ? (
          <Alert className="fl-new-version-source-alert" type="success" showIcon message="未发现历史关联" />
        ) : null}
          </>
        ) : null}

        <Form.Item
          label={(
            <Space>
              <span>关联需求</span>
              {versions.length ? <Button type="link" size="small" onClick={reuseLatest}>参考上一版</Button> : null}
            </Space>
          )}
        >
          <div className="fl-new-version-editor">
            <RequirementEditor
              value={requirements}
              onChange={(value) => {
                setRequirements(value);
                setPreflight(null);
                setWarningConfirmed(false);
              }}
            />
          </div>
        </Form.Item>

        {preflight?.blockers?.length ? (
          <Alert
            className="fl-new-version-source-alert"
            type="error"
            showIcon
            message={`发布前检查发现 ${preflight.blockers.length} 个阻断项`}
            description={<ul>{preflight.blockers.map((item: any, index: number) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul>}
          />
        ) : null}

        {preflight?.warnings?.length ? (
          <Alert
            className="fl-new-version-source-alert"
            type="warning"
            showIcon
            message={`发布前检查有 ${preflight.warnings.length} 条提醒`}
            description={(
              <div>
                <ul>{preflight.warnings.map((item: any, index: number) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul>
                <Checkbox checked={warningConfirmed} onChange={(event) => setWarningConfirmed(event.target.checked)}>
                  我已了解以上提醒，继续创建
                </Checkbox>
              </div>
            )}
          />
        ) : null}

        <Typography.Text className="fl-new-version-save-note" type="secondary">
          创建失败时会保留当前填写内容，可修改后重试。
        </Typography.Text>
      </Form>
        </>
      )}
    </Modal>
  );
}
