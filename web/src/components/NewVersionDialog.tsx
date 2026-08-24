import {
  CheckCircleFilled,
  CloudDownloadOutlined,
  FileTextOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
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
import { formatBytes, sourceSummary, validateHtmlFile } from './newVersionModel.js';

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
  changes?: ChangeItem[];
  requirements?: RequirementLink[];
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

function inferVersionNo(name: unknown) {
  const match = String(name || '').replace(/\.html?$/i, '').match(/v?\d+(?:\.\d+){0,3}/i);
  if (!match) return '';
  return /^v/i.test(match[0]) ? match[0].toLowerCase() : `v${match[0]}`;
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
  const changes = Form.useWatch('changes', form) || [];
  const requirements = Form.useWatch('requirements', form) || [];
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
  };

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      project: slug || undefined,
      changes: [],
      requirements: [],
    });
    setMode('file');
    resetSource();
  }, [form, open, slug]);

  const acceptHtml = async (value: string, name = '') => {
    const result = await api.inspectHtml(value) as HtmlInspection;
    setHtml(value);
    setExternalRefs(externalRefsOf(result));
    setSourceError('');

    if (!String(form.getFieldValue('versionNo') || '').trim() && name) {
      form.setFieldValue('versionNo', inferVersionNo(name));
    }
    if (!String(form.getFieldValue('title') || '').trim()) {
      form.setFieldValue('title', String(result.title || name.replace(/\.html?$/i, '')));
    }
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
      if (!String(form.getFieldValue('title') || '').trim()) {
        form.setFieldValue('title', String(result.title || '导入原型'));
      }
      if (!String(form.getFieldValue('versionNo') || '').trim()) {
        try {
          form.setFieldValue('versionNo', inferVersionNo(new URL(String(result.sourceUrl || url)).pathname));
        } catch {
          form.setFieldValue('versionNo', inferVersionNo(url));
        }
      }
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
    form.setFieldValue('changes', value);
    setImpacts([]);
    setImpactChecked(false);
  };

  const checkImpact = async () => {
    const changes = form.getFieldValue('changes') || [];
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

  const submit = async () => {
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
      await api.addVersion(project, {
        versionNo,
        title,
        html: acceptedHtml,
        changes: (values.changes || []).filter((item: any) => item.content?.trim()),
        requirements: (values.requirements || []).filter((item: any) => item.code?.trim()),
      });
      message.success(`版本 ${versionNo} 已创建`);
      onCreated(project, versionNo);
    } catch (error) {
      message.error(errorText(error, '创建版本失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      className="fl-new-version-dialog"
      title="新建版本"
      width={820}
      open={open}
      okText="创建版本"
      cancelText="取消"
      confirmLoading={saving}
      closable={!saving}
      maskClosable={!saving}
      onOk={() => void submit()}
      onCancel={onClose}
    >
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
            {fileName ? (
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
                showUploadList={false}
                disabled={importing}
                beforeUpload={(file) => {
                  void importFile(file);
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon"><UploadOutlined /></p>
                <p className="ant-upload-text">点击或拖拽 HTML 文件到此处</p>
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

        <Row gutter={16}>
          <Col xs={24} sm={8}>
            <Form.Item
              name="versionNo"
              label="版本号"
              help="字母数字与 . _ + -，同项目内唯一"
              rules={[{ required: true, whitespace: true, message: '请填写版本号' }]}
            >
              <Input className="fl-mono" placeholder="v1.0" maxLength={32} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={16}>
            <Form.Item
              name="title"
              label="版本标题"
              rules={[{ required: true, whitespace: true, message: '请填写版本标题' }]}
            >
              <Input placeholder="一句话说明本版主题" maxLength={100} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="变更日志" help="建版时可不填；设为基线时至少需要 1 条">
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

        <Form.Item label="关联需求">
          <div className="fl-new-version-editor">
            <RequirementEditor value={requirements} onChange={(value) => form.setFieldValue('requirements', value)} />
          </div>
        </Form.Item>

        <Typography.Text className="fl-new-version-save-note" type="secondary">
          创建失败时会保留当前填写内容，可修改后重试。
        </Typography.Text>
      </Form>
    </Modal>
  );
}
