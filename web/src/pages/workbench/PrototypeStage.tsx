import {
  CloudDownloadOutlined,
  CodeOutlined,
  CompressOutlined,
  DesktopOutlined,
  EditOutlined,
  ExpandOutlined,
  HighlightOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { Alert, Button, Checkbox, Tag, Tooltip, Typography } from 'antd';
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { AnnotationOverlay, type Anchor } from './AnnotationOverlay';

export type PrototypeStageHandle = {
  readEditedHtml: () => Promise<string>;
};

export type PrototypeStageProps = {
  version: any;
  previewSrc: string;
  editPreviewSrc: string;
  editable: boolean;
  docsCollapsed: boolean;
  useOffline: boolean;
  annotationMode: boolean;
  prototypeEditMode: boolean;
  selectedAnchor: Anchor | null;
  buildingOffline: boolean;
  htmlSaving: boolean;
  onOfflineChange: (value: boolean) => void;
  onToggleAnnotation: () => void;
  onTogglePrototypeEdit: () => void;
  onSavePrototypeEdit: () => void;
  onOpenHtmlEditor: () => void;
  onToggleDocs: () => void;
  onBuildOffline: () => void;
  onSelectAnchor: (anchor: Anchor, rect: DOMRect) => void;
  onCancelAnnotation: () => void;
};

const layout: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    height: '100%',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--fl-surface)',
  },
  toolbar: {
    display: 'flex',
    minWidth: 0,
    minHeight: 44,
    flex: '0 0 auto',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--fl-s-2)',
    padding: 'var(--fl-s-2) var(--fl-s-3)',
    borderBottom: '1px solid var(--fl-line)',
    background: 'var(--fl-surface)',
  },
  identity: {
    display: 'flex',
    minWidth: 0,
    flex: '1 1 220px',
    alignItems: 'center',
    gap: 'var(--fl-s-2)',
    overflow: 'hidden',
  },
  file: {
    minWidth: 0,
    overflow: 'hidden',
    color: 'var(--fl-text-2)',
    fontFamily: 'var(--pw-font-family-mono)',
    fontSize: 'var(--fl-fs-2)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    minWidth: 0,
    flex: '0 1 auto',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 'var(--fl-s-2)',
  },
  alert: {
    flex: '0 0 auto',
    margin: 'var(--fl-s-2) var(--fl-s-3) 0',
  },
  alertBody: {
    display: 'grid',
    gap: 'var(--fl-s-2)',
  },
  alertActions: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--fl-s-2)',
  },
  refs: {
    maxHeight: 132,
    margin: 0,
    overflow: 'auto',
    paddingLeft: 'var(--fl-s-5)',
  },
  ref: {
    padding: '2px 0',
    color: 'var(--fl-text-2)',
    fontFamily: 'var(--pw-font-family-mono)',
    fontSize: 'var(--fl-fs-2)',
    overflowWrap: 'anywhere',
  },
  canvas: {
    position: 'relative',
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
    background: 'var(--fl-bg)',
  },
  frame: {
    display: 'block',
    width: '100%',
    height: '100%',
    border: 0,
    background: 'var(--fl-surface)',
  },
};

function formatBytes(value: unknown) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function messageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const PrototypeStage = forwardRef<PrototypeStageHandle, PrototypeStageProps>(function PrototypeStage({
  version,
  previewSrc,
  editPreviewSrc,
  editable,
  docsCollapsed,
  useOffline,
  annotationMode,
  prototypeEditMode,
  selectedAnchor,
  buildingOffline,
  htmlSaving,
  onOfflineChange,
  onToggleAnnotation,
  onTogglePrototypeEdit,
  onSavePrototypeEdit,
  onOpenHtmlEditor,
  onToggleDocs,
  onBuildOffline,
  onSelectAnchor,
  onCancelAnnotation,
}, ref) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [refsOpen, setRefsOpen] = useState(false);
  const externalRefs = useMemo(
    () => (Array.isArray(version?.externalRefs) ? version.externalRefs.map(String) : []),
    [version?.externalRefs],
  );

  useImperativeHandle(ref, () => ({
    readEditedHtml: () => new Promise<string>((resolve, reject) => {
      const frameWindow = frameRef.current?.contentWindow;
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
        if (event.source !== frameWindow) return;
        const data = event.data && typeof event.data === 'object' ? event.data : {};
        if (data.type !== 'flowlark:edit-html' || data.id !== id) return;
        cleanup();
        resolve(String(data.html || ''));
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('EDIT_HTML_TIMEOUT'));
      }, 3000);

      window.addEventListener('message', onMessage);
      try {
        frameWindow.postMessage({ type: 'flowlark:get-edit-html', id }, '*');
      } catch (error) {
        cleanup();
        reject(error);
      }
    }),
  }), []);

  const selectAnchor = (anchor: Anchor) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    onSelectAnchor(anchor, new DOMRect(
      bounds.left + anchor.x * bounds.width,
      bounds.top + anchor.y * bounds.height,
      anchor.width * bounds.width,
      anchor.height * bounds.height,
    ));
  };

  return (
    <section style={layout.root} aria-label="原型预览工作区">
      <div style={layout.toolbar}>
        <div style={layout.identity}>
          <DesktopOutlined aria-hidden />
          <Typography.Text strong>原型预览</Typography.Text>
          <span style={layout.file} title={version?.file || ''}>
            {version?.file || '未命名文件'} · {formatBytes(version?.fileSize)}
          </span>
        </div>

        <div style={layout.actions}>
          <Tooltip title={version?.hasOffline ? '使用已内联外部资源的离线版' : '尚未生成离线版'}>
            <Checkbox
              checked={useOffline}
              disabled={!version?.hasOffline || prototypeEditMode}
              onChange={(event) => onOfflineChange(event.target.checked)}
            >
              离线预览
            </Checkbox>
          </Tooltip>
          <Tooltip title="原型由独立端口提供，脚本无法读取工作台数据">
            <Tag icon={<SafetyCertificateOutlined />}>沙箱隔离</Tag>
          </Tooltip>
          <Tooltip title={prototypeEditMode ? '请先退出在线编辑' : '在原型上框选区域并创建反馈'}>
            <Button
              size="small"
              type={annotationMode ? 'primary' : 'default'}
              icon={<HighlightOutlined />}
              disabled={prototypeEditMode}
              aria-pressed={annotationMode}
              onClick={onToggleAnnotation}
            >
              {annotationMode ? '退出标注' : '标注反馈'}
            </Button>
          </Tooltip>
          <Tooltip title={editable ? '直接编辑当前原型中的文字和内容' : '只有编辑中版本可以在线编辑'}>
            <Button
              size="small"
              type={prototypeEditMode ? 'primary' : 'default'}
              icon={<EditOutlined />}
              disabled={!editable || htmlSaving}
              aria-pressed={prototypeEditMode}
              onClick={onTogglePrototypeEdit}
            >
              {prototypeEditMode ? '退出编辑' : '在线编辑'}
            </Button>
          </Tooltip>
          {prototypeEditMode ? (
            <Button
              size="small"
              type="primary"
              icon={<SaveOutlined />}
              loading={htmlSaving}
              onClick={onSavePrototypeEdit}
            >
              保存
            </Button>
          ) : null}
          <Tooltip title={editable ? '用源码、文件或 URL 替换原型 HTML' : '只有编辑中版本可以修改原型文件'}>
            <Button
              size="small"
              icon={<CodeOutlined />}
              disabled={!editable || prototypeEditMode}
              onClick={onOpenHtmlEditor}
            >
              修改原型
            </Button>
          </Tooltip>
          <Tooltip title={docsCollapsed ? '恢复预览与文档分屏' : '收起文档区'}>
            <Button
              type="text"
              size="small"
              icon={docsCollapsed ? <CompressOutlined /> : <ExpandOutlined />}
              aria-label={docsCollapsed ? '恢复分屏' : '全宽预览'}
              onClick={onToggleDocs}
            >
              {docsCollapsed ? '分屏' : '全宽'}
            </Button>
          </Tooltip>
        </div>
      </div>

      {externalRefs.length ? (
        <Alert
          style={layout.alert}
          type={version?.hasOffline ? 'info' : 'warning'}
          showIcon
          message={`本原型依赖 ${externalRefs.length} 个外部资源`}
          description={(
            <div style={layout.alertBody}>
              <span>
                {version?.hasOffline
                  ? '离线版已就绪，可切换离线预览。'
                  : '网络不可用或资源被代理拦截时，原型样式可能不完整。'}
              </span>
              <div style={layout.alertActions}>
                {!version?.hasOffline ? (
                  <Button
                    size="small"
                    type="link"
                    icon={<CloudDownloadOutlined />}
                    loading={buildingOffline}
                    onClick={onBuildOffline}
                  >
                    生成离线版
                  </Button>
                ) : null}
                <Button size="small" type="link" onClick={() => setRefsOpen((value) => !value)}>
                  {refsOpen ? '收起清单' : '查看清单'}
                </Button>
              </div>
              {refsOpen ? (
                <ul style={layout.refs}>
                  {externalRefs.map((item, index) => (
                    <li key={`${item}-${index}`} style={layout.ref}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        />
      ) : null}

      <div ref={canvasRef} style={layout.canvas}>
        <iframe
          ref={frameRef}
          title="原型预览"
          src={prototypeEditMode ? editPreviewSrc : previewSrc}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          referrerPolicy="no-referrer"
          style={layout.frame}
        />
        <AnnotationOverlay
          active={annotationMode && !prototypeEditMode}
          anchor={selectedAnchor}
          onSelect={selectAnchor}
          onCancel={onCancelAnnotation}
        />
      </div>
    </section>
  );
});
