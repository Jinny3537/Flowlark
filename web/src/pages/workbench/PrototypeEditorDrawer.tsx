import {
  CheckCircleFilled,
  CloudDownloadOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Drawer,
  Flex,
  Input,
  Segmented,
  Space,
  Spin,
  Typography,
  Upload,
} from 'antd';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api } from '@/services/api';

const { Dragger } = Upload;
const { TextArea } = Input;

type SourceMode = 'code' | 'file' | 'url';

export type PrototypeEditorDrawerProps = {
  open: boolean;
  slug: string;
  versionNo: string;
  editable: boolean;
  hasOffline: boolean;
  maxFileBytes: number;
  onClose: () => void;
  onSaved: (nextVersion: any) => Promise<void> | void;
};

type HtmlInspection = {
  externalRefs?: unknown[];
};

type HtmlImport = HtmlInspection & {
  html?: unknown;
};

const layout: Record<string, CSSProperties> = {
  body: {
    display: 'flex',
    minHeight: 0,
    flexDirection: 'column',
    gap: 'var(--fl-s-4)',
  },
  mode: {
    width: '100%',
  },
  codeTools: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--fl-s-2)',
  },
  summary: {
    minWidth: 0,
    flex: '1 1 220px',
    color: 'var(--fl-text-2)',
    fontFamily: 'var(--pw-font-family-mono)',
    fontSize: 'var(--fl-fs-2)',
  },
  source: {
    fontFamily: 'var(--pw-font-family-mono)',
    fontSize: 'var(--fl-fs-3)',
    lineHeight: 1.55,
    resize: 'vertical',
  },
  ready: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--fl-s-3)',
    padding: 'var(--fl-s-3) var(--fl-s-4)',
    border: '1px solid var(--fl-primary-border)',
    borderRadius: 'var(--fl-r-3)',
    background: 'var(--fl-primary-bg)',
    color: 'var(--fl-primary-deep)',
  },
  readyText: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  refs: {
    maxHeight: 140,
    margin: 'var(--fl-s-2) 0 0',
    overflow: 'auto',
    paddingLeft: 'var(--fl-s-5)',
  },
  ref: {
    padding: '2px 0',
    fontFamily: 'var(--pw-font-family-mono)',
    fontSize: 'var(--fl-fs-2)',
    overflowWrap: 'anywhere',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function htmlBytes(value: string) {
  return new Blob([value]).size;
}

function externalRefsOf(result: HtmlInspection) {
  return Array.isArray(result.externalRefs) ? result.externalRefs.map(String) : [];
}

function errorText(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message || error.message === 'NETWORK') return fallback;
  return error.message;
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FILE_READ_FAILED'));
    reader.readAsText(file);
  });
}

export function PrototypeEditorDrawer({
  open,
  slug,
  versionNo,
  editable,
  hasOffline,
  maxFileBytes,
  onClose,
  onSaved,
}: PrototypeEditorDrawerProps) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<SourceMode>('code');
  const [htmlDraft, setHtmlDraft] = useState('');
  const [inspectedHtml, setInspectedHtml] = useState('');
  const [externalRefs, setExternalRefs] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const sourceRequestRef = useRef(0);

  const inspectionCurrent = inspectedHtml === htmlDraft;
  const summary = useMemo(() => {
    if (!htmlDraft) return '尚未读取 HTML';
    const dependencyText = inspectionCurrent ? `${externalRefs.length} 个外部依赖` : '依赖待检查';
    return `${formatBytes(htmlBytes(htmlDraft))} · ${dependencyText}`;
  }, [externalRefs.length, htmlDraft, inspectionCurrent]);

  useEffect(() => {
    if (!open) return undefined;
    const requestId = ++sourceRequestRef.current;
    let active = true;
    setMode('code');
    setSourceUrl('');
    setFileName('');
    setHtmlDraft('');
    setInspectedHtml('');
    setExternalRefs([]);
    setLoaded(false);
    setLoading(true);

    void (async () => {
      try {
        const html = await api.getHtml(slug, versionNo);
        if (!active || requestId !== sourceRequestRef.current) return;
        setHtmlDraft(html);
        setLoaded(true);
        try {
          const inspection = await api.inspectHtml(html) as HtmlInspection;
          if (!active || requestId !== sourceRequestRef.current) return;
          setExternalRefs(externalRefsOf(inspection));
          setInspectedHtml(html);
        } catch (error) {
          if (active) message.error(errorText(error, '原型已读取，但依赖检查失败'));
        }
      } catch (error) {
        if (active) message.error(errorText(error, '读取原型文件失败'));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      sourceRequestRef.current += 1;
    };
  }, [open, slug, versionNo]);

  const inspectDraft = async (noisy = false) => {
    const requestId = ++sourceRequestRef.current;
    const draft = htmlDraft;
    if (!draft.trim()) {
      setExternalRefs([]);
      setInspectedHtml(draft);
      if (noisy) message.warning('请先提供原型 HTML');
      return;
    }

    setInspecting(true);
    try {
      const result = await api.inspectHtml(draft) as HtmlInspection;
      if (requestId !== sourceRequestRef.current) return;
      setExternalRefs(externalRefsOf(result));
      setInspectedHtml(draft);
      if (noisy) message.success('原型依赖已检查');
    } catch (error) {
      message.error(errorText(error, '检查原型依赖失败'));
    } finally {
      if (requestId === sourceRequestRef.current) setInspecting(false);
    }
  };

  const importFile = async (file: File) => {
    if (!editable) {
      message.info('当前版本不可修改原型文件');
      return;
    }
    if (!/\.html?$/i.test(file.name)) {
      message.error('请上传 .html 或 .htm 文件');
      return;
    }
    if (maxFileBytes > 0 && file.size > maxFileBytes) {
      message.error(`${file.name} 超过上限 ${formatBytes(maxFileBytes)}`);
      return;
    }

    const requestId = ++sourceRequestRef.current;
    setImporting(true);
    try {
      const html = await readFile(file);
      if (requestId !== sourceRequestRef.current) return;
      setHtmlDraft(html);
      setFileName(file.name);
      setLoaded(true);
      try {
        const result = await api.inspectHtml(html) as HtmlInspection;
        if (requestId !== sourceRequestRef.current) return;
        setExternalRefs(externalRefsOf(result));
        setInspectedHtml(html);
      } catch (error) {
        message.error(errorText(error, '文件已读取，但依赖检查失败'));
      }
    } catch (error) {
      message.error(errorText(error, `读取 ${file.name} 失败`));
    } finally {
      if (requestId === sourceRequestRef.current) setImporting(false);
    }
  };

  const importFromUrl = async () => {
    const url = sourceUrl.trim();
    if (!url) {
      message.warning('请输入公开 URL');
      return;
    }

    const requestId = ++sourceRequestRef.current;
    setImporting(true);
    try {
      const result = await api.importUrl(url) as HtmlImport;
      if (requestId !== sourceRequestRef.current) return;
      const html = String(result.html || '');
      setHtmlDraft(html);
      setExternalRefs(externalRefsOf(result));
      setInspectedHtml(html);
      setFileName('');
      setLoaded(true);
    } catch (error) {
      message.error(errorText(error, '读取 URL 失败'));
    } finally {
      if (requestId === sourceRequestRef.current) setImporting(false);
    }
  };

  const save = async () => {
    if (!editable) {
      message.info('当前版本不可修改原型文件');
      return;
    }
    if (!htmlDraft.trim()) {
      message.warning('请先提供原型 HTML');
      return;
    }

    setSaving(true);
    try {
      const nextVersion = await api.replaceHtml(slug, versionNo, htmlDraft);
      message.success('原型文件已保存，预览已刷新');
      await onSaved(nextVersion);
      onClose();
    } catch (error) {
      message.error(errorText(error, '保存原型文件失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      title="修改原型文件"
      width="min(620px, 100vw)"
      destroyOnHidden
      closable={!saving}
      maskClosable={!saving}
      onClose={onClose}
      footer={(
        <div style={layout.footer}>
          <Space>
            <Button disabled={saving} onClick={onClose}>取消</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!editable || loading || importing || inspecting || !loaded || !htmlDraft.trim()}
              onClick={() => void save()}
            >
              保存并刷新预览
            </Button>
          </Space>
        </div>
      )}
    >
      <Spin spinning={loading}>
        <div style={layout.body}>
          {hasOffline ? (
            <Alert type="warning" showIcon message="保存后会清理旧离线版，需要时可重新生成。" />
          ) : null}
          {!editable ? (
            <Alert type="info" showIcon message="当前版本不可修改原型文件；请先恢复为编辑中或新建版本。" />
          ) : null}

          <Segmented<SourceMode>
            block
            style={layout.mode}
            value={mode}
            options={[
              { label: '源码', value: 'code' },
              { label: '文件', value: 'file' },
              { label: 'URL', value: 'url' },
            ]}
            onChange={(value) => {
              sourceRequestRef.current += 1;
              setImporting(false);
              setInspecting(false);
              setMode(value);
            }}
          />

          {mode === 'code' ? (
            <Flex vertical gap="small">
              <div style={layout.codeTools}>
                <span style={layout.summary}>{summary}</span>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={inspecting}
                  onClick={() => void inspectDraft(true)}
                >
                  检查依赖
                </Button>
              </div>
              <TextArea
                aria-label="完整 HTML 源码"
                value={htmlDraft}
                rows={20}
                spellCheck={false}
                style={layout.source}
                placeholder="在这里修改完整 HTML 源码，保存后刷新原型预览。"
                onChange={(event) => setHtmlDraft(event.target.value)}
              />
            </Flex>
          ) : null}

          {mode === 'file' ? (
            <Flex vertical gap="middle">
              <Dragger
                accept=".html,.htm"
                showUploadList={false}
                disabled={!editable}
                beforeUpload={(file) => {
                  void importFile(file);
                  return false;
                }}
              >
                <p><UploadOutlined aria-hidden /></p>
                <p>点击或拖拽 HTML 文件替换当前原型</p>
                <Typography.Text type="secondary">上限 {formatBytes(maxFileBytes)}</Typography.Text>
              </Dragger>
              {fileName ? (
                <div style={layout.ready}>
                  <CheckCircleFilled aria-hidden />
                  <div style={layout.readyText}>
                    <Typography.Text strong>{fileName}</Typography.Text>
                    <Typography.Text type="secondary">{summary}</Typography.Text>
                  </div>
                </div>
              ) : null}
            </Flex>
          ) : null}

          {mode === 'url' ? (
            <Flex vertical gap="middle">
              <Space.Compact block>
                <Input
                  aria-label="公开原型 URL"
                  value={sourceUrl}
                  placeholder="https://example.com/prototype"
                  onChange={(event) => setSourceUrl(event.target.value)}
                  onPressEnter={() => void importFromUrl()}
                />
                <Button
                  icon={<CloudDownloadOutlined />}
                  loading={importing}
                  onClick={() => void importFromUrl()}
                >
                  读取
                </Button>
              </Space.Compact>
              {htmlDraft ? (
                <div style={layout.ready}>
                  <CheckCircleFilled aria-hidden />
                  <div style={layout.readyText}>
                    <Typography.Text strong>原型已读取</Typography.Text>
                    <Typography.Text type="secondary">{summary}</Typography.Text>
                  </div>
                </div>
              ) : null}
            </Flex>
          ) : null}

          {inspectionCurrent && externalRefs.length ? (
            <Alert
              type="warning"
              showIcon
              message={`检测到 ${externalRefs.length} 个外部依赖，保存后可在预览区重新生成离线版。`}
              description={(
                <ul style={layout.refs}>
                  {externalRefs.map((item, index) => (
                    <li key={`${item}-${index}`} style={layout.ref}>{item}</li>
                  ))}
                </ul>
              )}
            />
          ) : null}
        </div>
      </Spin>
    </Drawer>
  );
}
