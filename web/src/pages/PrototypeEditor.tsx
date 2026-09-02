import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  FontColorsOutlined,
  ItalicOutlined,
  UnderlineOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Result, Select, Spin, Tag, Tooltip } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type HealthInfo } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { textOf } from '@/utils/format';
import { canEditStructure, previewUrl } from './workbench/workbenchModel.js';
import styles from './workbench/PrototypeEditor.module.css';

type EditorState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  justifyLeft: boolean;
  justifyCenter: boolean;
  justifyRight: boolean;
  fontSize: string;
  foreColor: string;
};

const EMPTY_STATE: EditorState = {
  bold: false,
  italic: false,
  underline: false,
  justifyLeft: false,
  justifyCenter: false,
  justifyRight: false,
  fontSize: '3',
  foreColor: '#151b18',
};

const FONT_SIZE_OPTIONS = [
  { value: '1', label: '12px' },
  { value: '2', label: '14px' },
  { value: '3', label: '16px' },
  { value: '4', label: '18px' },
  { value: '5', label: '24px' },
  { value: '6', label: '32px' },
  { value: '7', label: '48px' },
];

function messageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function editorStateOf(value: unknown): Partial<EditorState> {
  if (!value || typeof value !== 'object') return {};
  const state = value as Record<string, unknown>;
  return {
    bold: Boolean(state.bold),
    italic: Boolean(state.italic),
    underline: Boolean(state.underline),
    justifyLeft: Boolean(state.justifyLeft),
    justifyCenter: Boolean(state.justifyCenter),
    justifyRight: Boolean(state.justifyRight),
    fontSize: /^[1-7]$/.test(String(state.fontSize || '')) ? String(state.fontSize) : '3',
    foreColor: String(state.foreColor || ''),
  };
}

function normalizeColor(value: string) {
  const hex = String(value || '').match(/^#([0-9a-f]{6})$/i);
  if (hex) return hex[0];
  const rgb = String(value || '').match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return '#151b18';
  return `#${rgb.slice(1, 4).map((item) => Math.max(0, Math.min(255, Number(item)))
    .toString(16).padStart(2, '0')).join('')}`;
}

function readEditedHtml(frame: HTMLIFrameElement | null) {
  return new Promise<string>((resolve, reject) => {
    const frameWindow = frame?.contentWindow;
    if (!frameWindow) {
      reject(new Error('NO_FRAME'));
      return;
    }
    const id = messageId();
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data && typeof event.data === 'object'
        ? event.data as Record<string, unknown>
        : {};
      if (event.source !== frameWindow || data.type !== 'flowlark:edit-html' || data.id !== id) return;
      cleanup();
      resolve(String(data.html || ''));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('EDIT_HTML_TIMEOUT'));
    }, 3000);

    window.addEventListener('message', onMessage);
    frameWindow.postMessage({ type: 'flowlark:get-edit-html', id }, '*');
  });
}

export default function PrototypeEditor() {
  const { slug = '', versionNo = '' } = useParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loadRequestRef = useRef(0);
  const [project, setProject] = useState<any>(null);
  const [version, setVersion] = useState<any>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorState, setEditorState] = useState<EditorState>(EMPTY_STATE);

  const workbenchRoute = useMemo(
    () => `/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionNo)}`,
    [slug, versionNo],
  );
  const editable = canEditStructure({
    canWrite: health?.canWrite !== false,
    version,
    lockBaseline: health?.rules?.lockBaseline !== false,
  });
  const editorSrc = useMemo(() => previewUrl({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    previewPort: health?.previewPort || 7789,
    slug,
    versionNo,
    edit: true,
  }), [health?.previewPort, slug, versionNo]);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (!slug || !versionNo) {
      setError('缺少项目或版本参数');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [nextProject, nextVersion, nextHealth] = await Promise.all([
        api.getProject(slug),
        api.getVersion(slug, versionNo),
        api.health(),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setProject(nextProject);
      setVersion(nextVersion);
      setHealth(nextHealth);
    } catch (nextError) {
      if (requestId !== loadRequestRef.current) return;
      setError(errorText(nextError, '无法加载原型编辑页'));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [slug, versionNo]);

  useEffect(() => {
    setProject(null);
    setVersion(null);
    setHealth(null);
    setReady(false);
    setDirty(false);
    setEditorState(EMPTY_STATE);
    void load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data && typeof event.data === 'object'
        ? event.data as Record<string, unknown>
        : {};
      if (data.type === 'flowlark:edit-ready') {
        setReady(true);
        setEditorState((current) => ({ ...current, ...editorStateOf(data.state) }));
        return;
      }
      if (data.type === 'flowlark:edit-dirty') {
        setDirty(true);
        return;
      }
      if (data.type === 'flowlark:edit-state') {
        setEditorState((current) => ({ ...current, ...editorStateOf(data.state) }));
        return;
      }
      if (data.type === 'flowlark:edit-command-result') {
        if (data.state) {
          setEditorState((current) => ({ ...current, ...editorStateOf(data.state) }));
        }
        if (data.ok === false) message.error('当前选区无法应用此格式');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [message]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const sendCommand = (command: string, value: string | null = null) => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!ready || !frameWindow) {
      message.info('编辑器仍在加载，请稍后重试');
      return;
    }
    frameWindow.postMessage({
      type: 'flowlark:edit-command',
      id: messageId(),
      command,
      value,
    }, '*');
  };

  const exitEditor = () => {
    if (saving) return;
    if (!dirty) {
      navigate(workbenchRoute);
      return;
    }
    modal.confirm({
      title: '退出并放弃修改？',
      content: '当前原型还有未保存的文字或格式修改。',
      okText: '放弃修改',
      okButtonProps: { danger: true },
      cancelText: '继续编辑',
      onOk: () => navigate(workbenchRoute),
    });
  };

  const save = async () => {
    if (!editable || saving || !ready) return;
    setSaving(true);
    try {
      const html = await readEditedHtml(frameRef.current);
      if (!html.trim()) throw new Error('EMPTY_EDIT_HTML');
      await api.replaceHtml(slug, versionNo, html);
      setDirty(false);
      message.success('原型已保存');
      navigate(workbenchRoute, { replace: true });
    } catch (nextError) {
      message.error(errorText(nextError, '保存原型失败，修改仍保留在当前页面'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <main className={styles.statePage}><Spin size="large" tip="正在打开编辑器" /></main>;
  }

  if (error) {
    return (
      <main className={styles.statePage}>
        <Alert
          type="error"
          showIcon
          message="原型编辑页加载失败"
          description={error}
          action={(
            <div className={styles.stateActions}>
              <Button onClick={() => void load()}>重试</Button>
              <Button type="primary" onClick={() => navigate(workbenchRoute)}>返回工作台</Button>
            </div>
          )}
        />
      </main>
    );
  }

  if (!editable) {
    return (
      <main className={styles.statePage}>
        <Result
          status="info"
          title="当前版本不可在线编辑"
          subTitle={health?.canWrite === false
            ? '当前工作区是只读模式。'
            : '只有编辑中版本可以修改原型；基线、历史和已废弃版本保持只读。'}
          extra={<Button type="primary" onClick={() => navigate(workbenchRoute)}>返回版本工作台</Button>}
        />
      </main>
    );
  }

  const normalizedColor = normalizeColor(editorState.foreColor);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <strong>实时编辑</strong>
          <span className={styles.context} title={`${textOf(project?.name, slug)} / ${versionNo}`}>
            {textOf(project?.name, slug)} / {versionNo}
          </span>
          {saving ? <Tag color="processing">正在保存</Tag> : dirty ? <Tag color="warning">未保存</Tag> : <Tag>已同步</Tag>}
        </div>
        <Button disabled={saving} onClick={exitEditor}>退出编辑</Button>
      </header>

      <section className={styles.canvas} aria-label="原型文字编辑画布">
        <iframe
          ref={frameRef}
          className={styles.frame}
          title="可编辑原型"
          src={editorSrc}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          referrerPolicy="no-referrer"
        />
        {!ready ? (
          <div className={styles.connecting} role="status">
            <Spin size="small" />
            <span>正在连接编辑器…</span>
          </div>
        ) : null}
      </section>

      <div className={styles.toolbarShell}>
        <div className={styles.toolbar} role="toolbar" aria-label="文字格式工具栏">
          <div className={styles.toolsScroller}>
            <Tooltip title="加粗">
              <Button
                icon={<BoldOutlined />}
                aria-label="加粗"
                aria-pressed={editorState.bold}
                type={editorState.bold ? 'primary' : 'default'}
                disabled={!ready || saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => sendCommand('bold')}
              />
            </Tooltip>
            <Tooltip title="斜体">
              <Button
                icon={<ItalicOutlined />}
                aria-label="斜体"
                aria-pressed={editorState.italic}
                type={editorState.italic ? 'primary' : 'default'}
                disabled={!ready || saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => sendCommand('italic')}
              />
            </Tooltip>
            <Tooltip title="下划线">
              <Button
                icon={<UnderlineOutlined />}
                aria-label="下划线"
                aria-pressed={editorState.underline}
                type={editorState.underline ? 'primary' : 'default'}
                disabled={!ready || saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => sendCommand('underline')}
              />
            </Tooltip>

            <span className={styles.divider} aria-hidden />

            <Select
              className={styles.fontSize}
              aria-label="字号"
              value={editorState.fontSize}
              options={FONT_SIZE_OPTIONS}
              disabled={!ready || saving}
              onChange={(value) => sendCommand('fontSize', value)}
            />
            <Tooltip title="文字颜色">
              <label className={styles.colorControl} aria-label="文字颜色">
                <FontColorsOutlined aria-hidden />
                <input
                  type="color"
                  value={normalizedColor}
                  disabled={!ready || saving}
                  aria-label="选择文字颜色"
                  onChange={(event) => sendCommand('foreColor', event.target.value)}
                />
              </label>
            </Tooltip>

            <span className={styles.divider} aria-hidden />

            <Tooltip title="左对齐">
              <Button
                icon={<AlignLeftOutlined />}
                aria-label="左对齐"
                aria-pressed={editorState.justifyLeft}
                type={editorState.justifyLeft ? 'primary' : 'default'}
                disabled={!ready || saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => sendCommand('justifyLeft')}
              />
            </Tooltip>
            <Tooltip title="居中">
              <Button
                icon={<AlignCenterOutlined />}
                aria-label="居中"
                aria-pressed={editorState.justifyCenter}
                type={editorState.justifyCenter ? 'primary' : 'default'}
                disabled={!ready || saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => sendCommand('justifyCenter')}
              />
            </Tooltip>
            <Tooltip title="右对齐">
              <Button
                icon={<AlignRightOutlined />}
                aria-label="右对齐"
                aria-pressed={editorState.justifyRight}
                type={editorState.justifyRight ? 'primary' : 'default'}
                disabled={!ready || saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => sendCommand('justifyRight')}
              />
            </Tooltip>
          </div>

          <Button
            className={styles.completeButton}
            type="primary"
            loading={saving}
            disabled={!ready}
            onClick={() => void save()}
          >
            完成
          </Button>
        </div>
      </div>
    </main>
  );
}
