import {
  ArrowLeftOutlined,
  BranchesOutlined,
  DownloadOutlined,
  ExportOutlined,
  HistoryOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Segmented, Select, Spin, Tag, Tooltip } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type HealthInfo } from '@/services/api';
import { textOf } from '@/utils/format';
import { FeedbackDrawer } from './workbench/FeedbackDrawer';
import { PrototypeEditorDrawer } from './workbench/PrototypeEditorDrawer';
import { PrototypeStage, type PrototypeStageHandle } from './workbench/PrototypeStage';
import { BaselineModal, ReviewStatusControl } from './workbench/WorkbenchPrimitives';
import { WorkbenchDocuments } from './workbench/WorkbenchDocuments';
import { VersionHistoryDrawer } from './workbench/WorkbenchDrawers';
import {
  canEditStructure,
  decodeAnchor,
  encodeAnchor,
  previewUrl,
} from './workbench/workbenchModel.js';
import styles from './workbench/VersionWorkbench.module.css';

const DEFAULT_SPLIT = 68;

function withRefresh(url: string, refresh: number) {
  if (!refresh) return url;
  return `${url}${url.includes('?') ? '&' : '?'}refresh=${refresh}`;
}

export default function VersionWorkbench() {
  const { slug = '', versionNo = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const anchorQuery = searchParams.get('anchor');
  const { message } = App.useApp();

  const [project, setProject] = useState<any>(null);
  const [version, setVersion] = useState<any>(null);
  const [siblings, setSiblings] = useState<any[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [commits, setCommits] = useState<any[]>([]);
  const [specCommits, setSpecCommits] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [supplementaryError, setSupplementaryError] = useState('');

  const [activeTab, setActiveTab] = useState('spec');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [htmlEditorOpen, setHtmlEditorOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [useOffline, setUseOffline] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [prototypeEditMode, setPrototypeEditMode] = useState(false);
  const [docsCollapsed, setDocsCollapsed] = useState(
    () => localStorage.getItem('flowlark.docsCollapsed') === '1',
  );
  const [mobileMode, setMobileMode] = useState<string>('preview');
  const [selectedAnchor, setSelectedAnchor] = useState<any>(null);
  const [captureRect, setCaptureRect] = useState<DOMRect | null>(null);
  const [buildingOffline, setBuildingOffline] = useState(false);
  const [htmlSaving, setHtmlSaving] = useState(false);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [leftPct, setLeftPct] = useState(
    () => Number(localStorage.getItem('flowlark.split')) || DEFAULT_SPLIT,
  );
  const [dragging, setDragging] = useState(false);

  const requestIdRef = useRef(0);
  const supplementaryRequestRef = useRef(0);
  const stageRef = useRef<PrototypeStageHandle>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const routeKey = `${slug}\u0000${versionNo}`;
  const routeKeyRef = useRef(routeKey);
  routeKeyRef.current = routeKey;

  const canWrite = health?.canWrite !== false;
  const editable = canEditStructure({
    canWrite,
    version,
    lockBaseline: health?.rules?.lockBaseline !== false,
  });
  const currentBaselineNo = useMemo(
    () => siblings.find((item) => item.isBaseline)?.versionNo || project?.baselineVersionNo || null,
    [project?.baselineVersionNo, siblings],
  );

  const previewBase = useMemo(() => previewUrl({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    previewPort: health?.previewPort || 7789,
    slug,
    versionNo,
    offline: useOffline,
  }), [health?.previewPort, slug, useOffline, versionNo]);
  const previewSrc = useMemo(
    () => withRefresh(previewBase, previewRefresh),
    [previewBase, previewRefresh],
  );
  const editPreviewSrc = useMemo(() => previewUrl({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    previewPort: health?.previewPort || 7789,
    slug,
    versionNo,
    edit: true,
  }), [health?.previewPort, slug, versionNo]);

  const refreshVersion = useCallback(async (nextVersion?: any) => {
    const expectedRoute = routeKey;
    if (routeKeyRef.current !== expectedRoute) return;
    if (nextVersion?.versionNo) {
      if (String(nextVersion.versionNo) !== versionNo) return;
      setVersion(nextVersion);
      return;
    }
    if (!slug || !versionNo) return;
    const loadedVersion = await api.getVersion(slug, versionNo);
    if (routeKeyRef.current === expectedRoute) setVersion(loadedVersion);
  }, [routeKey, slug, versionNo]);

  const refreshSpecHistory = useCallback(async () => {
    if (!slug || !versionNo) return;
    const expectedRoute = routeKey;
    try {
      const items = await api.specHistory(slug, versionNo) as any[];
      if (routeKeyRef.current === expectedRoute) setSpecCommits(items);
    } catch {
      if (routeKeyRef.current === expectedRoute) setSupplementaryError('规格历史刷新失败，可重试附加数据加载。');
    }
  }, [routeKey, slug, versionNo]);

  const refreshTags = useCallback(async () => {
    const expectedRoute = routeKey;
    try {
      const items = await api.allTags() as any[];
      if (routeKeyRef.current === expectedRoute) setAllTags(items);
    } catch {
      if (routeKeyRef.current === expectedRoute) setSupplementaryError('标签选项刷新失败，可重试附加数据加载。');
    }
  }, [routeKey]);

  const refreshFeedback = useCallback(async () => {
    const expectedRoute = routeKey;
    try {
      const items = await api.listFeedbackDrafts() as any[];
      if (routeKeyRef.current === expectedRoute) setFeedbacks(items);
    } catch {
      if (routeKeyRef.current === expectedRoute) setSupplementaryError('反馈草稿刷新失败，可重试附加数据加载。');
    }
  }, [routeKey]);

  const reloadSupplementary = useCallback(async (expectedRoute = routeKey) => {
    const requestId = ++supplementaryRequestRef.current;
    setHistoryLoading(true);
    const results = await Promise.allSettled([
      api.versionHistory(slug, versionNo),
      api.specHistory(slug, versionNo),
      api.allTags(),
      api.listFeedbackDrafts(),
    ]);
    if (requestId !== supplementaryRequestRef.current || routeKeyRef.current !== expectedRoute) return;
    const [nextHistory, nextSpecHistory, nextTags, nextFeedback] = results;
    if (nextHistory.status === 'fulfilled') setCommits(nextHistory.value as any[]);
    if (nextSpecHistory.status === 'fulfilled') setSpecCommits(nextSpecHistory.value as any[]);
    if (nextTags.status === 'fulfilled') setAllTags(nextTags.value as any[]);
    if (nextFeedback.status === 'fulfilled') setFeedbacks(nextFeedback.value as any[]);
    const failed = ['版本历史', '规格历史', '标签', '反馈']
      .filter((_, index) => results[index].status === 'rejected');
    setSupplementaryError(failed.length ? `${failed.join('、')}加载失败，其他工作台功能仍可使用。` : '');
    setHistoryLoading(false);
  }, [routeKey, slug, versionNo]);

  const load = useCallback(async () => {
    if (!slug || !versionNo) return;
    const expectedRoute = routeKey;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const [nextProject, nextVersion, nextSiblings, nextHealth] = await Promise.all([
        api.getProject(slug),
        api.getVersion(slug, versionNo),
        api.listVersions(slug, { includeDraft: true, includeVoid: true }),
        api.health(),
      ]);
      if (requestId !== requestIdRef.current || routeKeyRef.current !== expectedRoute) return;
      setProject(nextProject);
      setVersion(nextVersion);
      setSiblings(nextSiblings);
      setHealth(nextHealth);
      setUseOffline(Boolean(nextVersion.hasOffline));

      void reloadSupplementary(expectedRoute);
    } catch (nextError) {
      if (requestId !== requestIdRef.current || routeKeyRef.current !== expectedRoute) return;
      setError(nextError instanceof Error ? nextError.message : '无法读取版本工作台');
    } finally {
      if (requestId === requestIdRef.current && routeKeyRef.current === expectedRoute) setLoading(false);
    }
  }, [reloadSupplementary, routeKey, slug, versionNo]);

  useEffect(() => {
    setVersion(null);
    setSupplementaryError('');
    setActiveTab('spec');
    setHistoryOpen(false);
    setBaselineOpen(false);
    setHtmlEditorOpen(false);
    setFeedbackOpen(false);
    setAnnotationMode(false);
    setPrototypeEditMode(false);
    setSelectedAnchor(decodeAnchor(anchorQuery));
    setCaptureRect(null);
    setPreviewRefresh(0);
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [anchorQuery, load]);

  useEffect(() => {
    localStorage.setItem('flowlark.docsCollapsed', docsCollapsed ? '1' : '0');
  }, [docsCollapsed]);

  const moveSplit = useCallback((clientX: number) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLeftPct(Math.max(30, Math.min(88, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event: PointerEvent) => moveSplit(event.clientX);
    const onUp = () => {
      setDragging(false);
      setLeftPct((value) => {
        localStorage.setItem('flowlark.split', String(Math.round(value)));
        return value;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, moveSplit]);

  const resetSplit = () => {
    setLeftPct(DEFAULT_SPLIT);
    localStorage.setItem('flowlark.split', String(DEFAULT_SPLIT));
  };

  const goCompare = () => {
    const other = siblings.find((item) => item.versionNo !== versionNo);
    const query = new URLSearchParams({ a: versionNo });
    if (other?.versionNo) query.set('b', other.versionNo);
    navigate(`/projects/${encodeURIComponent(slug)}/compare?${query}`);
  };

  const copyPreviewLink = async () => {
    try {
      await navigator.clipboard.writeText(previewBase);
      message.success('预览直链已复制');
    } catch {
      message.error('复制失败，可在版本信息中手动复制');
    }
  };

  const toggleAnnotation = () => {
    if (prototypeEditMode) {
      message.info('请先退出在线编辑，再进行标注反馈');
      return;
    }
    setAnnotationMode((value) => !value);
    setSelectedAnchor(null);
  };

  const togglePrototypeEdit = () => {
    if (!editable) {
      message.info('只有编辑中版本可以在线编辑');
      return;
    }
    setAnnotationMode(false);
    setUseOffline(false);
    setPrototypeEditMode((value) => !value);
  };

  const savePrototypeEdit = async () => {
    if (!editable) return;
    const expectedRoute = routeKey;
    setHtmlSaving(true);
    let html = '';
    try {
      html = await stageRef.current?.readEditedHtml() || '';
      if (!html?.trim()) throw new Error('EMPTY_EDIT_HTML');
      if (routeKeyRef.current !== expectedRoute) {
        setHtmlSaving(false);
        return;
      }
    } catch {
      message.error('读取在线编辑内容失败，请重试');
      setHtmlSaving(false);
      return;
    }
    try {
      const nextVersion = await api.replaceHtml(slug, versionNo, html);
      if (routeKeyRef.current !== expectedRoute) return;
      setVersion(nextVersion);
      setPrototypeEditMode(false);
      setUseOffline(false);
      setPreviewRefresh((value) => value + 1);
      message.success('原型文件已保存，预览已刷新');
    } catch (saveError) {
      message.error(saveError instanceof Error ? saveError.message : '原型文件保存失败');
    } finally {
      setHtmlSaving(false);
    }
  };

  const buildOffline = async () => {
    if (!canWrite) {
      message.info('当前是只读模式，不能生成离线版本');
      return;
    }
    const expectedRoute = routeKey;
    setBuildingOffline(true);
    try {
      const result: any = await api.buildOffline(slug, versionNo);
      if (routeKeyRef.current !== expectedRoute) return;
      if (result.failed?.length) {
        message.warning(`已生成，但 ${result.failed.length} 个资源抓取失败`);
      } else {
        message.success(`离线版已生成，内联 ${result.inlined}/${result.total} 个资源`);
      }
      await refreshVersion();
      setUseOffline(true);
    } catch (offlineError) {
      message.error(offlineError instanceof Error ? offlineError.message : '离线版生成失败');
    } finally {
      setBuildingOffline(false);
    }
  };

  const selectAnchor = (anchor: any, rect: DOMRect) => {
    setSelectedAnchor(anchor);
    setCaptureRect(rect);
    setAnnotationMode(false);
    setFeedbackOpen(true);
  };

  const feedbackContext = useMemo(() => ({
    project: slug,
    version: versionNo,
    baseline: currentBaselineNo,
    requirements: (version?.requirements || []).map((item: any) => item.code),
    changes: version?.changes || [],
    anchor: selectedAnchor || { x: 0, y: 0, width: 1, height: 1 },
    url: `${window.location.origin}${window.location.pathname}#/projects/${encodeURIComponent(slug)}`
      + `/versions/${encodeURIComponent(versionNo)}?anchor=${encodeURIComponent(encodeAnchor(
        selectedAnchor || { x: 0, y: 0, width: 1, height: 1 },
      ))}`,
  }), [currentBaselineNo, selectedAnchor, slug, version, versionNo]);

  const onPrototypeSaved = async (nextVersion: any) => {
    if (routeKeyRef.current !== routeKey || String(nextVersion?.versionNo || '') !== versionNo) return;
    setVersion(nextVersion);
    setUseOffline(false);
    setPreviewRefresh((value) => value + 1);
  };

  return (
    <main className={styles.page}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarIdentity}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(`/projects/${encodeURIComponent(slug)}`)}
          >
            返回
          </Button>
          <strong>{textOf(project?.name, slug)}</strong>
        </div>
        <Select
          className={styles.versionSelect}
          value={versionNo}
          options={siblings.map((item) => ({
            value: item.versionNo,
            label: `${item.versionNo} · ${textOf(item.title, '未命名版本')}`,
          }))}
          onChange={(next) => navigate(`/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(next)}`)}
        />
        {version ? <Tag color={version.display?.color}>{textOf(version.display?.label, '未知状态')}</Tag> : null}
        {version ? (
          <ReviewStatusControl
            slug={slug}
            versionNo={versionNo}
            status={version.reviewStatus}
            disabled={!canWrite}
            onChanged={refreshVersion}
          />
        ) : null}
        <div className={styles.toolbarActions}>
          <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>历史</Button>
          <Button icon={<BranchesOutlined />} onClick={goCompare}>并排对比</Button>
          <Tooltip title="复制原型预览直链">
            <Button icon={<LinkOutlined />} onClick={() => void copyPreviewLink()}>直链</Button>
          </Tooltip>
          <Button
            icon={<ExportOutlined />}
            onClick={() => window.open(previewBase, '_blank', 'noopener,noreferrer')}
          >
            新窗口
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => window.open(api.downloadUrl(slug, versionNo), '_blank', 'noopener,noreferrer')}
          >
            下载
          </Button>
          {version?.isBaseline ? (
            <Button disabled>当前基线</Button>
          ) : version && version.display?.key !== 'VOID' ? (
            <Button type="primary" disabled={!canWrite} onClick={() => setBaselineOpen(true)}>
              {version.display?.key === 'HISTORY' ? '回滚为基线' : '设为当前基线'}
            </Button>
          ) : null}
        </div>
      </header>

      {!canWrite && !loading ? (
        <Alert
          className={styles.readonlyAlert}
          type="info"
          showIcon
          message="当前工作区只读"
          description={health?.readonlyReason || '可以查看原型和文档，但不能保存修改。'}
        />
      ) : null}
      {error ? (
        <Alert
          className={styles.coreError}
          type="error"
          showIcon
          message="版本工作台加载失败"
          description={error}
          action={<Button onClick={() => void load()}>重试</Button>}
        />
      ) : null}
      {supplementaryError && !loading ? (
        <Alert
          className={styles.coreError}
          type="warning"
          showIcon
          message="部分附加数据未加载"
          description={supplementaryError}
          action={<Button onClick={() => void reloadSupplementary()}>重试</Button>}
          closable
          onClose={() => setSupplementaryError('')}
        />
      ) : null}

      {loading && !version ? (
        <div className={styles.loadingStage}><Spin size="large" /></div>
      ) : version && !error ? (
        <>
          <div className={styles.mobileMode}>
            <Segmented
              block
              value={mobileMode}
              options={[
                { label: '原型预览', value: 'preview' },
                { label: '版本文档', value: 'documents' },
              ]}
              onChange={(value) => setMobileMode(String(value))}
            />
          </div>
          <div className={styles.stage} ref={workspaceRef}>
            <section
              className={`${styles.previewPane} ${docsCollapsed ? styles.previewPaneFull : ''}`
                + ` ${mobileMode !== 'preview' ? styles.mobileHidden : ''}`}
              style={{ width: docsCollapsed ? undefined : `${leftPct}%` }}
              aria-label="原型预览区域"
            >
              <PrototypeStage
                ref={stageRef}
                version={version}
                previewSrc={previewSrc}
                editPreviewSrc={editPreviewSrc}
                editable={editable}
                docsCollapsed={docsCollapsed}
                useOffline={useOffline}
                annotationMode={annotationMode}
                prototypeEditMode={prototypeEditMode}
                selectedAnchor={selectedAnchor}
                buildingOffline={buildingOffline}
                htmlSaving={htmlSaving}
                onOfflineChange={setUseOffline}
                onToggleAnnotation={toggleAnnotation}
                onTogglePrototypeEdit={togglePrototypeEdit}
                onSavePrototypeEdit={() => void savePrototypeEdit()}
                onOpenHtmlEditor={() => setHtmlEditorOpen(true)}
                onToggleDocs={() => setDocsCollapsed((value) => !value)}
                onBuildOffline={() => void buildOffline()}
                onSelectAnchor={selectAnchor}
                onCancelAnnotation={() => setAnnotationMode(false)}
              />
            </section>
            {!docsCollapsed ? (
              <button
                className={`${styles.splitter} ${dragging ? styles.splitterDragging : ''}`}
                type="button"
                aria-label="拖动调整原型与文档宽度，双击恢复默认"
                onPointerDown={() => setDragging(true)}
                onDoubleClick={resetSplit}
              />
            ) : null}
            <section
              className={`${styles.documentPane} ${docsCollapsed ? styles.documentPaneCollapsed : ''}`
                + ` ${mobileMode !== 'documents' ? styles.mobileHidden : ''}`}
              aria-label="版本文档区域"
            >
              <WorkbenchDocuments
                activeTab={activeTab}
                onTabChange={setActiveTab}
                slug={slug}
                versionNo={versionNo}
                version={version}
                siblings={siblings}
                  canWrite={canWrite}
                  lockBaseline={health?.rules?.lockBaseline !== false}
                maxFileBytes={health?.maxFileBytes || 10 * 1024 * 1024}
                requirementUrlTemplate={health?.requirementUrlTemplate || ''}
                allTags={allTags}
                specCommits={specCommits}
                feedbacks={feedbacks}
                previewUrl={previewBase}
                onVersionChanged={refreshVersion}
                onSpecHistoryChanged={refreshSpecHistory}
                onTagsChanged={refreshTags}
                onFeedbackChanged={refreshFeedback}
              />
            </section>
          </div>
        </>
      ) : null}

      <PrototypeEditorDrawer
        open={htmlEditorOpen}
        slug={slug}
        versionNo={versionNo}
        editable={editable}
        hasOffline={Boolean(version?.hasOffline)}
        maxFileBytes={health?.maxFileBytes || 10 * 1024 * 1024}
        onClose={() => setHtmlEditorOpen(false)}
        onSaved={onPrototypeSaved}
      />
      <BaselineModal
        open={baselineOpen}
        slug={slug}
        target={version}
        current={currentBaselineNo}
        totalVersions={siblings.length}
        requireChangelog={health?.rules?.requireChangelog !== false}
        onClose={() => setBaselineOpen(false)}
        onDone={async () => {
          setBaselineOpen(false);
          await load();
        }}
      />
      <FeedbackDrawer
        open={feedbackOpen}
        context={feedbackContext}
        captureRect={captureRect}
        onClose={() => setFeedbackOpen(false)}
        onSubmitted={refreshFeedback}
      />
      <VersionHistoryDrawer
        open={historyOpen}
        commits={commits}
        loading={historyLoading}
        onClose={() => setHistoryOpen(false)}
      />
    </main>
  );
}
