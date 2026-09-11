import {
  CloudDownloadOutlined,
  CodeOutlined,
  CompressOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EditOutlined,
  ExpandOutlined,
  ExportOutlined,
  HighlightOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Alert, Button, Checkbox, Popover, Tag, Tooltip, Typography } from 'antd';
import {
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import styles from './VersionWorkbench.module.css';
import { AnnotationOverlay, type Anchor } from './AnnotationOverlay';

export type PrototypeStageProps = {
  version: any;
  previewSrc: string;
  editable: boolean;
  docsCollapsed: boolean;
  useOffline: boolean;
  annotationMode: boolean;
  selectedAnchor: Anchor | null;
  buildingOffline: boolean;
  onOfflineChange: (value: boolean) => void;
  onToggleAnnotation: () => void;
  onOpenPrototypeEditor: () => void;
  onOpenHtmlEditor: () => void;
  onCopyPreviewLink: () => void;
  onOpenPreview: () => void;
  onDownloadPrototype: () => void;
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

export function PrototypeStage({
  version,
  previewSrc,
  editable,
  docsCollapsed,
  useOffline,
  annotationMode,
  selectedAnchor,
  buildingOffline,
  onOfflineChange,
  onToggleAnnotation,
  onOpenPrototypeEditor,
  onOpenHtmlEditor,
  onCopyPreviewLink,
  onOpenPreview,
  onDownloadPrototype,
  onToggleDocs,
  onBuildOffline,
  onSelectAnchor,
  onCancelAnnotation,
}: PrototypeStageProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const externalRefs = useMemo(
    () => (Array.isArray(version?.externalRefs) ? version.externalRefs.map(String) : []),
    [version?.externalRefs],
  );

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
          <Tooltip title="复制可直接访问当前原型的预览地址">
            <Button size="small" icon={<LinkOutlined />} onClick={onCopyPreviewLink}>
              复制预览直链
            </Button>
          </Tooltip>
          <Tooltip title="在新的浏览器窗口打开当前原型">
            <Button size="small" icon={<ExportOutlined />} onClick={onOpenPreview}>
              新窗口打开
            </Button>
          </Tooltip>
          <Tooltip title="下载当前版本的原型文件">
            <Button size="small" icon={<DownloadOutlined />} onClick={onDownloadPrototype}>
              下载原型
            </Button>
          </Tooltip>
          <Tooltip title={version?.hasOffline ? '使用已内联外部资源的离线版' : '尚未生成离线版'}>
            <Checkbox
              checked={useOffline}
              disabled={!version?.hasOffline}
              onChange={(event) => onOfflineChange(event.target.checked)}
            >
              离线预览
            </Checkbox>
          </Tooltip>
          <Tooltip title="原型由独立端口提供，脚本无法读取工作台数据">
            <Tag icon={<SafetyCertificateOutlined />}>沙箱隔离</Tag>
          </Tooltip>
          <Tooltip title="在原型上框选区域并创建反馈">
            <Button
              size="small"
              type={annotationMode ? 'primary' : 'default'}
              icon={<HighlightOutlined />}
              aria-pressed={annotationMode}
              onClick={onToggleAnnotation}
            >
              {annotationMode ? '退出标注' : '标注反馈'}
            </Button>
          </Tooltip>
          <Tooltip title={editable ? '直接编辑当前原型中的文字和内容' : '只有编辑中版本可以在线编辑'}>
            <Button
              size="small"
              icon={<EditOutlined />}
              disabled={!editable}
              onClick={onOpenPrototypeEditor}
            >
              在线编辑
            </Button>
          </Tooltip>
          <Tooltip title={editable ? '用源码、文件或 URL 替换原型 HTML' : '只有编辑中版本可以修改原型文件'}>
            <Button
              size="small"
              icon={<CodeOutlined />}
              disabled={!editable}
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
          className={styles.compactNotice}
          message={(
            <div className={styles.noticeRow}>
              <span>{externalRefs.length} 个外部资源{version?.hasOffline ? ' · 离线版已就绪' : ''}</span>
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
              <Popover
                trigger="click"
                placement="bottomLeft"
                title="外部资源"
                content={(
                  <div className={styles.noticeDetails}>
                    <p>
                      {version?.hasOffline
                        ? '离线版已就绪，可切换离线预览。'
                        : '网络不可用或资源被代理拦截时，原型样式可能不完整。'}
                    </p>
                    <ul style={layout.refs}>
                      {externalRefs.map((item, index) => (
                        <li key={`${item}-${index}`} style={layout.ref}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              >
                <Button size="small" type="link">查看清单</Button>
              </Popover>
            </div>
          )}
        />
      ) : null}

      <div ref={canvasRef} style={layout.canvas}>
        <iframe
          ref={frameRef}
          title="原型预览"
          src={previewSrc}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          referrerPolicy="no-referrer"
          style={layout.frame}
        />
        <AnnotationOverlay
          active={annotationMode}
          anchor={selectedAnchor}
          onSelect={selectAnchor}
          onCancel={onCancelAnnotation}
        />
      </div>
    </section>
  );
}
