import {
  App,
  Alert,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowRightOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FilterOutlined,
  HistoryOutlined,
  InboxOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { NewVersionDialog } from '@/components/NewVersionDialog';
import { api, type HealthInfo } from '@/services/api';
import { fmtTime, textOf } from '@/utils/format';
import {
  adjacentVersionNo,
  comparisonTargets,
  filterVersions,
  planningBadges,
  projectFilterQuery,
  projectFilterState,
  reviewStateOf,
} from './projectVersionsModel';
import styles from './ProjectVersions.module.css';

type SelectVersionOptions = {
  force?: boolean;
  openMobile?: boolean;
};

const versionNoOf = (version: any) => String(version?.versionNo || version?.no || '');
const createdAtOf = (version: any) => version?.createdAt || version?.updatedAt;
const createdByOf = (version: any) => version?.createdBy || version?.updatedBy || '-';
const isBaselineVersion = (version: any) => Boolean(version?.isBaseline || version?.baseline);

function displayOf(version: any) {
  if (version?.display?.key) return version.display;
  if (version?.draft) return { key: 'DRAFT', label: '编辑中', color: 'gold' };
  if (version?.void) return { key: 'VOID', label: '已废弃', color: 'default' };
  return { key: 'HISTORY', label: '历史版本', color: 'default' };
}

export default function ProjectVersions() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message, modal } = App.useApp();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const canWrite = health?.canWrite !== false;

  const [project, setProject] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const initialFilters = useRef(projectFilterState(searchParams));
  const [includeVoid, setIncludeVoid] = useState(initialFilters.current.includeVoid);
  const [query, setQuery] = useState(initialFilters.current.query);
  const [statusFilter, setStatusFilter] = useState(initialFilters.current.status);
  const [sortOrder, setSortOrder] = useState(initialFilters.current.order);
  const [authorFilter, setAuthorFilter] = useState(initialFilters.current.author);
  const [requirementFilter, setRequirementFilter] = useState(initialFilters.current.requirement);
  const [externalOnly, setExternalOnly] = useState(initialFilters.current.external);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [selectedVersionNo, setSelectedVersionNo] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [newVersionOpen, setNewVersionOpen] = useState(false);
  const [planning, setPlanning] = useState<any>(null);
  const [planningError, setPlanningError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  const selectedVersionNoRef = useRef<string | null>(null);
  const detailCacheRef = useRef(new Map<string, any>());
  const detailRequestIdRef = useRef(0);
  const pageRequestIdRef = useRef(0);
  const indexListRef = useRef<HTMLDivElement>(null);

  const baseline = useMemo(
    () => versions.find((version) => isBaselineVersion(version)) || null,
    [versions],
  );
  const canRollback = useMemo(
    () => versions.some((version) =>
      !isBaselineVersion(version) && version.baselineAt && displayOf(version).key !== 'VOID'),
    [versions],
  );
  const newCount = useMemo(
    () => versions.filter((version) => version.isNew).length,
    [versions],
  );
  const filteredVersions = useMemo(
    () => filterVersions(versions, {
      query,
      status: statusFilter,
      order: sortOrder,
      author: authorFilter,
      requirement: requirementFilter,
      external: externalOnly,
    }),
    [authorFilter, externalOnly, query, requirementFilter, sortOrder, statusFilter, versions],
  );
  const statusOptions = useMemo(() => {
    const values = new Map<string, string>();
    versions.forEach((version) => {
      const display = displayOf(version);
      values.set(display.key, display.label);
    });
    return [
      { value: 'all', label: '全部状态' },
      ...Array.from(values, ([value, label]) => ({ value, label })),
    ];
  }, [versions]);
  const compareTargets = useMemo(() => comparisonTargets(
    versions,
    versionNoOf(planning?.baseline || baseline),
    selectedVersionNo || '',
    versionNoOf(planning?.previousBaseline),
  ), [baseline, planning, selectedVersionNo, versions]);
  const commandBadges = useMemo(() => planningBadges(planning || {}), [planning]);

  const loadPlanning = useCallback(async () => {
    if (!slug) return;
    setPlanningError('');
    try {
      setPlanning(await api.projectPlanning(slug));
    } catch (error) {
      setPlanning(null);
      setPlanningError(error instanceof Error ? error.message : '无法读取项目规划摘要');
    }
  }, [slug]);

  const selectVersion = useCallback(async (
    versionNo: string | null,
    { force = false, openMobile = false }: SelectVersionOptions = {},
  ) => {
    if (!slug || !versionNo) return;
    const requestId = ++detailRequestIdRef.current;
    selectedVersionNoRef.current = versionNo;
    setSelectedVersionNo(versionNo);
    setDetailError('');

    if (openMobile && window.matchMedia('(max-width: 899px)').matches) {
      setMobileDetailOpen(true);
    }

    if (!force && detailCacheRef.current.has(versionNo)) {
      setSelectedVersion(detailCacheRef.current.get(versionNo));
      setDetailLoading(false);
      return;
    }

    setDetailLoading(true);
    try {
      const detail = await api.getVersion(slug, versionNo);
      if (
        requestId !== detailRequestIdRef.current ||
        selectedVersionNoRef.current !== versionNo
      ) return;
      detailCacheRef.current.set(versionNo, detail);
      setSelectedVersion(detail);
    } catch (error) {
      if (requestId !== detailRequestIdRef.current) return;
      setSelectedVersion(null);
      setDetailError(error instanceof Error ? error.message : '无法读取版本详情');
    } finally {
      if (requestId === detailRequestIdRef.current) setDetailLoading(false);
    }
  }, [slug]);

  const loadPage = useCallback(async () => {
    if (!slug) return;
    const requestId = ++pageRequestIdRef.current;
    setLoading(true);
    setPageError('');
    try {
      const [nextProject, list, nextHealth] = await Promise.all([
        api.getProject(slug),
        api.listVersions(slug, { includeDraft: true, includeVoid }),
        api.health(),
      ]);
      if (requestId !== pageRequestIdRef.current) return;
      setProject(nextProject);
      setVersions(list);
      setHealth(nextHealth);

      const preserved = list.some(
        (version) => versionNoOf(version) === selectedVersionNoRef.current,
      );
      const nextSelection = preserved
        ? selectedVersionNoRef.current
        : versionNoOf(list[0]) || null;

      if (nextSelection) {
        void selectVersion(nextSelection, { force: true });
      } else {
        selectedVersionNoRef.current = null;
        setSelectedVersionNo(null);
        setSelectedVersion(null);
      }
    } catch (error) {
      if (requestId !== pageRequestIdRef.current) return;
      setPageError(error instanceof Error ? error.message : '无法读取项目版本');
    } finally {
      if (requestId === pageRequestIdRef.current) setLoading(false);
    }
  }, [includeVoid, selectVersion, slug]);

  useEffect(() => {
    detailRequestIdRef.current += 1;
    detailCacheRef.current.clear();
    selectedVersionNoRef.current = null;
    setSelectedVersionNo(null);
    setSelectedVersion(null);
    setMobileDetailOpen(false);
    void loadPage();
    void loadPlanning();
    return () => {
      pageRequestIdRef.current += 1;
      detailRequestIdRef.current += 1;
    };
  }, [loadPage, loadPlanning]);

  useEffect(() => {
    let cancelled = false;
    setFiltersHydrated(false);
    const apply = (value: any) => {
      if (cancelled) return;
      const next = projectFilterState(value);
      setQuery(next.query);
      setStatusFilter(next.status);
      setSortOrder(next.order);
      setAuthorFilter(next.author);
      setRequirementFilter(next.requirement);
      setExternalOnly(next.external);
      setIncludeVoid(next.includeVoid);
      setFiltersHydrated(true);
    };
    if (searchParams.toString()) {
      apply(searchParams);
    } else {
      api.projectPreference(slug).then(apply).catch(() => apply({}));
    }
    return () => { cancelled = true; };
    // URL 只在项目切换时作为初始状态；后续由本地筛选状态驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!filtersHydrated || !slug) return undefined;
    const state = {
      query,
      status: statusFilter,
      order: sortOrder,
      author: authorFilter,
      requirement: requirementFilter,
      external: externalOnly,
      includeVoid,
    };
    const nextQuery = projectFilterQuery(state);
    if (nextQuery !== searchParams.toString()) setSearchParams(nextQuery, { replace: true });
    const timer = window.setTimeout(() => {
      void api.setProjectPreference(slug, state).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    authorFilter, externalOnly, filtersHydrated, includeVoid, query, requirementFilter,
    searchParams, setSearchParams, slug, sortOrder, statusFilter,
  ]);

  useEffect(() => {
    if (!filteredVersions.length) return;
    if (!filteredVersions.some(
      (version: any) => versionNoOf(version) === selectedVersionNo,
    )) {
      void selectVersion(versionNoOf(filteredVersions[0]));
    }
  }, [filteredVersions, selectVersion, selectedVersionNo]);

  const reloadAll = useCallback(async () => {
    detailCacheRef.current.clear();
    await Promise.all([loadPage(), loadPlanning()]);
  }, [loadPage, loadPlanning]);

  const openWorkbench = useCallback((versionNo: string) => {
    navigate(`/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionNo)}`);
  }, [navigate, slug]);

  const openComparison = useCallback((pair: { a: string; b: string } | null) => {
    if (!pair) return;
    const params = new URLSearchParams({ mode: 'versions', a: pair.a, b: pair.b });
    navigate(`/projects/${encodeURIComponent(slug)}/compare?${params}`);
  }, [navigate, slug]);

  const copyText = useCallback(async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(success);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '复制失败');
    }
  }, [message]);

  const ensureWritable = useCallback(() => {
    if (canWrite) return true;
    message.info('当前是只读模式，不能执行写操作');
    return false;
  }, [canWrite, message]);

  const setBaseline = useCallback(async (version: any) => {
    if (!ensureWritable()) return;
    const versionNo = versionNoOf(version);
    if (version.reviewStatus === 'questions' && !version.baselineAt) {
      message.warning('该版本仍有评审疑问，请先处理问题并更新评审状态');
      return;
    }
    if (versions.length > 1 && !version?.baselineAt && !version?.changes?.length && !version?.changeCount) {
      message.warning('设为基线前至少需要 1 条变更说明');
      return;
    }
    let cumulative: any = null;
    if (baseline && versionNoOf(baseline) !== versionNo) {
      try {
        cumulative = await api.cumulative(slug, versionNoOf(baseline), versionNo);
      } catch {
        cumulative = null;
      }
    }
    const counts = (cumulative?.items || []).reduce((value: any, item: any) => {
      const type = ['ADD', 'REMOVE'].includes(item.type) ? item.type : 'MODIFY';
      value[type] += 1;
      return value;
    }, { ADD: 0, MODIFY: 0, REMOVE: 0 });
    modal.confirm({
      title: `将 ${versionNo} 设为当前基线？`,
      content: (
        <div className={styles.confirmSummary}>
          <p>研发默认将按这版原型和规格开发。</p>
          <dl>
            <div><dt>替换基线</dt><dd>{baseline ? versionNoOf(baseline) : '未设置'} → {versionNo}</dd></div>
            <div><dt>评审状态</dt><dd>{reviewStateOf(version).label}</dd></div>
            <div><dt>累计变更</dt><dd>新增 {counts.ADD} · 修改 {counts.MODIFY} · 删除 {counts.REMOVE}</dd></div>
            <div><dt>关联需求</dt><dd>{version.requirementCount || version.requirements?.length || 0} 条</dd></div>
            <div><dt>外部依赖</dt><dd>{version.externalRefs?.length || 0} 个</dd></div>
            <div><dt>通知渠道</dt><dd>{planning?.notificationProvider || '未配置'}</dd></div>
          </dl>
        </div>
      ),
      okText: '设为基线',
      onOk: async () => {
        const result: any = await api.setBaseline(slug, versionNo);
        const notificationFailed = (result.notificationResults || []).some((item: any) => item.ok === false);
        await reloadAll();
        modal.success({
          title: `${versionNo} 已成为当前基线`,
          content: (
            <div className={styles.resultSummary}>
              <p>{notificationFailed ? '基线已更新，但部分通知发送失败，可在设置或通知中心重试。' : '基线和评审状态已更新。'}</p>
              <Space wrap>
                <Button onClick={() => openWorkbench(versionNo)}>打开基线</Button>
                {baseline ? <Button icon={<SwapOutlined />} onClick={() => openComparison({ a: versionNoOf(baseline), b: versionNo })}>查看对比</Button> : null}
                <Button icon={<CopyOutlined />} onClick={() => void copyText(
                  `# ${project?.name || slug} 当前基线\n\n- 版本：${versionNo}\n- 标题：${version.title || ''}\n- 上一基线：${baseline ? versionNoOf(baseline) : '无'}\n`,
                  '基线摘要已复制',
                )}>复制摘要</Button>
              </Space>
            </div>
          ),
        });
      },
    });
  }, [
    baseline, copyText, ensureWritable, message, modal, openComparison, openWorkbench,
    planning, project?.name, reloadAll, slug, versions.length,
  ]);

  const rollbackBaseline = useCallback(async () => {
    if (!ensureWritable()) return;
    setRollbackLoading(true);
    try {
      const preview: any = await api.rollbackPreview(slug);
      modal.confirm({
        title: `回滚到 ${versionNoOf(preview.target)}？`,
        icon: <UndoOutlined />,
        content: (
          <div className={styles.confirmSummary}>
            <p>当前基线会进入历史记录，上一版研发基线将重新生效。</p>
            <dl>
              <div><dt>基线变化</dt><dd>{versionNoOf(preview.current)} → {versionNoOf(preview.target)}</dd></div>
              <div><dt>撤回变更</dt><dd>新增 {preview.changeCounts?.ADD || 0} · 修改 {preview.changeCounts?.MODIFY || 0} · 删除 {preview.changeCounts?.REMOVE || 0}</dd></div>
              <div><dt>受影响需求</dt><dd>{preview.requirements?.join('、') || '无明确需求号'}</dd></div>
              <div><dt>通知渠道</dt><dd>{preview.notificationProvider || '未配置'}</dd></div>
            </dl>
          </div>
        ),
        okText: '确认回滚',
        okButtonProps: { danger: true },
        onOk: async () => {
          const version: any = await api.rollbackProject(slug);
          await reloadAll();
          modal.success({
            title: `已回滚到 ${versionNoOf(version)}`,
            content: (
              <Space wrap>
                <Button onClick={() => openWorkbench(versionNoOf(version))}>打开当前基线</Button>
                <Button icon={<SwapOutlined />} onClick={() => openComparison({
                  a: versionNoOf(version), b: versionNoOf(preview.current),
                })}>查看撤回内容</Button>
              </Space>
            ),
          });
        },
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '无法生成回滚预览');
    } finally {
      setRollbackLoading(false);
    }
  }, [ensureWritable, message, modal, openComparison, openWorkbench, reloadAll, slug]);

  const markRead = useCallback(async (versionNo: string) => {
    await api.markRead(slug, versionNo);
    message.success(`已标记看到 ${versionNo}`);
    await loadPage();
  }, [loadPage, message, slug]);

  const confirmVoid = useCallback((version: any) => {
    if (!ensureWritable()) return;
    const versionNo = versionNoOf(version);
    modal.confirm({
      title: `废弃版本 ${versionNo}？`,
      content: '废弃后默认不在版本索引显示，记录仍然保留。',
      okText: '废弃',
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.voidVersion(slug, versionNo);
        message.success('已废弃');
        detailCacheRef.current.delete(versionNo);
        await loadPage();
      },
    });
  }, [ensureWritable, loadPage, message, modal, slug]);

  const reopenVersion = useCallback(async (version: any) => {
    if (!ensureWritable()) return;
    const versionNo = versionNoOf(version);
    await api.reopenVersion(slug, versionNo);
    message.success('已恢复为编辑中');
    detailCacheRef.current.delete(versionNo);
    await loadPage();
  }, [ensureWritable, loadPage, message, slug]);

  const confirmRemove = useCallback((version: any) => {
    if (!ensureWritable()) return;
    const versionNo = versionNoOf(version);
    modal.confirm({
      title: `删除版本 ${versionNo}？`,
      content: '文件会移入 .flowlark/trash，可在回收站恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.removeVersion(slug, versionNo);
        message.success('已移入回收站');
        detailCacheRef.current.delete(versionNo);
        await loadPage();
      },
    });
  }, [ensureWritable, loadPage, message, modal, slug]);

  const handleDetailAction = useCallback((key: string, version: any) => {
    const versionNo = versionNoOf(version);
    if (key === 'read') void markRead(versionNo);
    if (key === 'download') {
      window.open(api.downloadUrl(slug, versionNo), '_blank', 'noopener,noreferrer');
    }
    if (key === 'void') confirmVoid(version);
    if (key === 'reopen') void reopenVersion(version);
    if (key === 'remove') confirmRemove(version);
  }, [confirmRemove, confirmVoid, markRead, reopenVersion, slug]);

  const handleIndexKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') {
      if (selectedVersionNo) openWorkbench(selectedVersionNo);
      return;
    }
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextVersionNo = adjacentVersionNo(filteredVersions, selectedVersionNo, direction);
    if (!nextVersionNo) return;
    void selectVersion(nextVersionNo);
    requestAnimationFrame(() => {
      const target = Array.from(
        indexListRef.current?.querySelectorAll<HTMLButtonElement>('[data-version-no]') || [],
      ).find((element) => element.dataset.versionNo === nextVersionNo);
      target?.focus();
    });
  }, [filteredVersions, openWorkbench, selectVersion, selectedVersionNo]);

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setSortOrder('newest');
    setAuthorFilter('');
    setRequirementFilter('');
    setExternalOnly(false);
  };

  const renderVersionSummary = (testId: string) => {
    if (detailLoading) {
      return (
        <section className={styles.summary} data-testid={testId} aria-label="版本详情加载中">
          <Skeleton active paragraph={{ rows: 7 }} />
        </section>
      );
    }
    if (detailError) {
      return (
        <section className={styles.summary} data-testid={testId} aria-label="版本详情">
          <Alert
            type="warning"
            showIcon
            message="版本详情加载失败"
            description={detailError}
            action={(
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void selectVersion(selectedVersionNo, { force: true })}
              >
                重试
              </Button>
            )}
          />
        </section>
      );
    }
    if (!selectedVersion) {
      return (
        <section className={styles.summary} data-testid={testId} aria-label="版本详情">
          <Empty description="选择一个版本查看详情" />
        </section>
      );
    }

    const display = displayOf(selectedVersion);
    const review = reviewStateOf(selectedVersion);
    const versionNo = versionNoOf(selectedVersion);
    const detailMenuItems: MenuProps['items'] = [
      { key: 'read', label: '标记为已读' },
      { key: 'download', label: '下载 HTML', icon: <DownloadOutlined /> },
      { type: 'divider' },
      display.key === 'VOID'
        ? { key: 'reopen', label: '恢复为编辑中', disabled: !canWrite }
        : { key: 'void', label: '废弃', disabled: !canWrite || isBaselineVersion(selectedVersion) },
      {
        key: 'remove', label: '删除', danger: true,
        disabled: !canWrite || isBaselineVersion(selectedVersion),
      },
    ];

    return (
      <section className={styles.summary} data-testid={testId} aria-label="版本详情">
        <header className={styles.summaryHead}>
          <div className={styles.summaryIdentity}>
            <div className={styles.summaryStatus}>
              <Tag color={display.color}>{display.label}</Tag>
              <Tag color={review.color}>{review.label}</Tag>
              {isBaselineVersion(selectedVersion) ? (
                <span className={styles.baselineLabel}>当前基线</span>
              ) : null}
            </div>
            <h2><span className="fl-mono">{versionNo}</span> {textOf(selectedVersion.title, '未命名版本')}</h2>
            <div className={styles.summaryMeta}>
              <span>{createdByOf(selectedVersion)}</span>
              <span>{fmtTime(createdAtOf(selectedVersion))}</span>
              <span><FileTextOutlined aria-hidden />{selectedVersion.changeCount || selectedVersion.changes?.length || 0} 条变更</span>
              <span><LinkOutlined aria-hidden />{selectedVersion.requirementCount || selectedVersion.requirements?.length || 0} 条需求</span>
              <span><ThunderboltOutlined aria-hidden />{selectedVersion.externalRefs?.length || 0} 个外部依赖</span>
            </div>
          </div>
          <Space wrap className={styles.summaryActions}>
            {!isBaselineVersion(selectedVersion) && display.key !== 'VOID' ? (
              <Button disabled={!canWrite} onClick={() => void setBaseline(selectedVersion)}>
                {display.key === 'HISTORY' ? '回滚为基线' : '设为基线'}
              </Button>
            ) : null}
            {compareTargets.selectedVsBaseline ? (
              <Button icon={<SwapOutlined />} onClick={() => openComparison(compareTargets.selectedVsBaseline)}>
                与当前基线比较
              </Button>
            ) : null}
            <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => openWorkbench(versionNo)}>
              打开工作台
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{ items: detailMenuItems, onClick: ({ key }) => handleDetailAction(key, selectedVersion) }}
            >
              <Button aria-label="更多版本操作" icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        </header>

        <section className={styles.summarySection} aria-labelledby={`${testId}-changes`}>
          <h3 id={`${testId}-changes`}>变更日志</h3>
          {selectedVersion.changes?.length ? (
            <div className={styles.changeList}>
              {selectedVersion.changes.map((change: any, index: number) => (
                <div className={styles.changeRow} key={`${change.location || 'change'}-${change.type || 'item'}-${index}`}>
                  <span className={styles.changeLocation}>{change.location || '未标注位置'}</span>
                  <span>{change.content || change.description || '未填写变更说明'}</span>
                </div>
              ))}
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未记录变更日志" />}
        </section>

        <section className={styles.summarySection} aria-labelledby={`${testId}-requirements`}>
          <h3 id={`${testId}-requirements`}>关联需求</h3>
          {selectedVersion.requirements?.length ? (
            <div className={styles.requirementList}>
              {selectedVersion.requirements.map((requirement: any, index: number) => {
                const code = typeof requirement === 'string' ? requirement : requirement.code;
                const title = typeof requirement === 'string' ? '' : requirement.title;
                return (
                  <div className={styles.requirementRow} key={code || `requirement-${index}`}>
                    <span className={`fl-mono ${styles.breakText}`}>{code || '未编号'}</span>
                    <span className={styles.breakText}>{title || '未填写标题'}</span>
                  </div>
                );
              })}
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未关联需求" />}
        </section>
      </section>
    );
  };

  return (
    <main className={`fl-page ${styles.page}`}>
      <PageHeader
        eyebrow="项目版本"
        title={project?.name || slug}
        backTo="/projects"
        actions={(
          <Space wrap>
            <Button
              icon={<InboxOutlined />}
              onClick={() => navigate(`/watch?project=${encodeURIComponent(slug)}`)}
            >
              草稿箱{planning?.watchCount ? ` ${planning.watchCount}` : ''}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canWrite}
              onClick={() => setNewVersionOpen(true)}
            >
              新建版本
            </Button>
          </Space>
        )}
      />

      <section className={styles.projectMeta} aria-label="项目摘要">
        <span><small>项目代码</small><strong className="fl-mono">{textOf(project?.code, slug)}</strong></span>
        <span><small>优先级</small><strong>{textOf(project?.priority, '未设置')}</strong></span>
        <span><small>版本总数</small><strong>{project?.versionCount ?? versions.length}</strong></span>
        <span><small>当前基线</small><strong className="fl-mono">{baseline ? versionNoOf(baseline) : '未设置'}</strong></span>
        <span><small>最近更新</small><strong>{fmtTime(project?.updatedAt)}</strong></span>
      </section>

      {!canWrite ? (
        <Alert
          className={styles.pageAlert}
          type="info"
          showIcon
          message="当前是只读模式"
          description="可以浏览、标记已读和下载；新建版本、设置基线、回滚、废弃和删除需要写权限。"
        />
      ) : null}

      {versions.length ? (
        <section className={styles.baselineStrip} aria-label="版本状态摘要">
          <div className={styles.baselineContent}>
            <div className={styles.baselineMain}>
              <span className={styles.baselineKicker}>{baseline ? '当前开发基线' : '基线状态'}</span>
              <strong className="fl-mono">{baseline ? versionNoOf(baseline) : '未设置'}</strong>
              <span className={styles.baselineTitle}>
                {baseline ? textOf(baseline.title, '未命名版本') : '尚未设置开发基线，请从已记录变更的版本中选择'}
              </span>
              {newCount > 0 ? <span className={styles.readMarker}>{newCount} 个新版本</span> : null}
            </div>
            {baseline ? (
              <span className={styles.baselineMeta}>
                {createdByOf(baseline)} · {fmtTime(baseline.baselineAt || createdAtOf(baseline))}
                {' · '}{baseline.requirementCount || baseline.requirements?.length || 0} 条需求
              </span>
            ) : null}
            {planning?.previousBaseline ? (
              <div className={styles.changeDigest} aria-label="相对上一基线的累计变更">
                <span>相对 {versionNoOf(planning.previousBaseline)}</span>
                <strong>新增 {planning.changeCounts?.ADD || 0}</strong>
                <strong>修改 {planning.changeCounts?.MODIFY || 0}</strong>
                <strong>删除 {planning.changeCounts?.REMOVE || 0}</strong>
                {planning.previousBaselineSource === 'local' ? <small>根据本地记录推断</small> : null}
              </div>
            ) : baseline ? <span className={styles.baselineMeta}>首个基线，暂无上一基线</span> : null}
            {commandBadges.length ? (
              <Space wrap size={[6, 6]} className={styles.commandBadges}>
                {commandBadges.map((badge) => badge.key === 'watch' ? (
                  <Button
                    key={badge.key}
                    size="small"
                    onClick={() => navigate(`/watch?project=${encodeURIComponent(slug)}`)}
                  >
                    <Tag color={badge.color}>{badge.label}</Tag>
                  </Button>
                ) : (
                  <Tag key={badge.key} color={badge.color}>{badge.label}</Tag>
                ))}
              </Space>
            ) : null}
          </div>
          <Space wrap className={styles.commandActions}>
            {baseline ? <Button type="primary" onClick={() => openWorkbench(versionNoOf(baseline))}>打开当前基线</Button> : null}
            {compareTargets.baselineVsPrevious ? (
              <Button icon={<SwapOutlined />} onClick={() => openComparison(compareTargets.baselineVsPrevious)}>
                与上一基线比较
              </Button>
            ) : null}
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>基线历史</Button>
            {newCount > 0 ? (
              <Button size="small" onClick={() => void markRead(versionNoOf(versions[0]))}>标记最新为已读</Button>
            ) : null}
            {baseline && canRollback ? (
              <Button icon={<UndoOutlined />} loading={rollbackLoading} disabled={!canWrite} onClick={() => void rollbackBaseline()}>
                回滚上一版
              </Button>
            ) : null}
          </Space>
        </section>
      ) : null}

      {planningError ? (
        <Alert
          className={styles.pageAlert}
          type="warning"
          showIcon
          message="规划摘要暂不可用"
          description={planningError}
          action={<Button size="small" onClick={() => void loadPlanning()}>重试</Button>}
        />
      ) : null}

      {pageError ? (
        <Alert
          className={styles.pageAlert}
          type="error"
          showIcon
          message="项目版本加载失败"
          description={pageError}
          action={<Button icon={<ReloadOutlined />} onClick={() => void loadPage()}>重试</Button>}
        />
      ) : null}

      {!loading && !pageError && versions.length === 0 ? (
        <section className={styles.pageEmpty} aria-label="项目版本空状态">
          <span className={styles.emptyIcon} aria-hidden><FileAddOutlined /></span>
          <h2>还没有版本</h2>
          <p>创建首个版本后，可以在这里查看原型、变更和关联需求。</p>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canWrite}
            onClick={() => setNewVersionOpen(true)}
          >
            创建首个版本
          </Button>
          <Checkbox checked={includeVoid} onChange={(event) => setIncludeVoid(event.target.checked)}>
            显示已废弃版本
          </Checkbox>
        </section>
      ) : null}
      {loading && !versions.length ? (
        <div className={styles.pageSkeleton}><Skeleton active paragraph={{ rows: 8 }} /></div>
      ) : null}

      {versions.length ? (
        <section className={styles.versionBrowser} data-testid="version-browser" aria-label="版本浏览器">
          <aside className={styles.versionIndex} aria-label="版本索引">
            <div className={styles.indexToolbar}>
              <Input
                allowClear
                aria-label="搜索版本"
                placeholder="搜索版本、标题、标签或需求"
                prefix={<SearchOutlined />}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className={styles.indexFilters}>
                <Select aria-label="筛选版本状态" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
                <Select
                  aria-label="版本排序"
                  options={[
                    { value: 'newest', label: '最新优先' },
                    { value: 'oldest', label: '最早优先' },
                  ]}
                  value={sortOrder}
                  onChange={setSortOrder}
                />
              </div>
              <div className={styles.indexOptions}>
                <Checkbox checked={includeVoid} onChange={(event) => setIncludeVoid(event.target.checked)}>
                  显示已废弃版本
                </Checkbox>
                <Button
                  type="link"
                  size="small"
                  icon={<FilterOutlined />}
                  aria-expanded={advancedFiltersOpen}
                  onClick={() => setAdvancedFiltersOpen((value) => !value)}
                >
                  {advancedFiltersOpen ? '收起高级筛选' : '高级筛选'}
                </Button>
              </div>
              {advancedFiltersOpen ? (
                <div className={styles.advancedFilters}>
                  <Input
                    allowClear
                    aria-label="按创建人筛选"
                    placeholder="创建人"
                    value={authorFilter}
                    onChange={(event) => setAuthorFilter(event.target.value)}
                  />
                  <Input
                    allowClear
                    aria-label="按关联需求筛选"
                    placeholder="需求编号或标题"
                    value={requirementFilter}
                    onChange={(event) => setRequirementFilter(event.target.value)}
                  />
                  <Checkbox checked={externalOnly} onChange={(event) => setExternalOnly(event.target.checked)}>
                    仅看有外部依赖
                  </Checkbox>
                </div>
              ) : null}
            </div>

            {filteredVersions.length ? (
              <div
                className={styles.indexList}
                ref={indexListRef}
                role="listbox"
                aria-label="版本列表"
                onKeyDown={handleIndexKeyDown}
              >
                {filteredVersions.map((version: any) => {
                  const versionNo = versionNoOf(version);
                  const display = displayOf(version);
                  const review = reviewStateOf(version);
                  return (
                    <button
                      className={`${styles.indexRow} ${versionNo === selectedVersionNo ? styles.selected : ''}`}
                      type="button"
                      role="option"
                      aria-label={`${versionNo} ${textOf(version.title, '未命名版本')}，${display.label}，${review.label}`}
                      aria-selected={versionNo === selectedVersionNo}
                      data-version-no={versionNo}
                      key={versionNo}
                      onClick={() => void selectVersion(versionNo, { openMobile: true })}
                    >
                      <span className={`fl-mono ${styles.indexVersion}`}>{versionNo}</span>
                      <span className={styles.indexCopy}>
                        <Tooltip title={textOf(version.title, '未命名版本')}>
                          <span className={styles.indexTitle}>{textOf(version.title, '未命名版本')}</span>
                        </Tooltip>
                        <span className={styles.indexMeta}>
                          <span>{createdByOf(version)} · {fmtTime(createdAtOf(version))}</span>
                          {version.isNew ? <span className={styles.readMarker}>新</span> : null}
                          {!version.isNew && version.isLastRead ? <span className={styles.readMarker}>上次看到这里</span> : null}
                        </span>
                      </span>
                      <span className={styles.indexState}>
                        {isBaselineVersion(version) ? (
                          <span className={styles.baselineLabel}>基线</span>
                        ) : <Tag color={display.color}>{display.label}</Tag>}
                        <Tag color={review.color}>{review.label}</Tag>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className={styles.filterEmpty}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的版本">
                  <Button onClick={clearFilters}>清除筛选</Button>
                </Empty>
              </div>
            )}
          </aside>

          <div className={styles.desktopSummary}>
            {renderVersionSummary('desktop-version-summary')}
          </div>
        </section>
      ) : null}

      <Drawer
        className={styles.detailDrawer}
        open={mobileDetailOpen}
        title="版本详情"
        size="100%"
        destroyOnHidden
        onClose={() => setMobileDetailOpen(false)}
      >
        {renderVersionSummary('mobile-version-summary')}
      </Drawer>
      <Drawer
        className={styles.historyDrawer}
        open={historyOpen}
        title="基线历史"
        width={560}
        onClose={() => setHistoryOpen(false)}
      >
        {planning?.historyError ? (
          <Alert
            type="warning"
            showIcon
            message="Git 基线历史不可用"
            description={`${planning.historyError}。当前页面已使用本地 baselineAt 记录降级。`}
          />
        ) : null}
        {planning?.history?.length ? (
          <div className={styles.historyList}>
            {planning.history.map((item: any, index: number) => {
              const older = planning.history[index + 1];
              return (
                <article className={styles.historyItem} key={item.hash || `${item.versionNo}-${index}`}>
                  <div>
                    <Tag color={index === 0 ? 'blue' : 'default'}>{index === 0 ? '当前记录' : '历史记录'}</Tag>
                    <strong className="fl-mono">{item.versionNo || '未知版本'}</strong>
                  </div>
                  <p>{item.subject || '基线切换'}</p>
                  <small>{item.author || '-'} · {fmtTime(item.date)} · {item.short || item.hash?.slice(0, 8)}</small>
                  {older?.versionNo && older.versionNo !== item.versionNo ? (
                    <Button
                      size="small"
                      icon={<SwapOutlined />}
                      onClick={() => openComparison({ a: older.versionNo, b: item.versionNo })}
                    >
                      与上一条比较
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <Empty description={planning?.historyError ? '无法读取 Git 历史' : '暂无已提交的基线历史'} />
        )}
        <Divider />
        <Typography.Text type="secondary">
          基线历史来自 Git 提交；尚未同步的本地切换可能只出现在页面当前状态中。
        </Typography.Text>
      </Drawer>
      <NewVersionDialog
        open={newVersionOpen}
        slug={slug}
        maxFileBytes={health?.maxFileBytes || 10 * 1024 * 1024}
        onClose={() => setNewVersionOpen(false)}
        onCreated={(_, versionNo) => {
          setNewVersionOpen(false);
          selectedVersionNoRef.current = versionNo;
          setSelectedVersionNo(versionNo);
          void reloadAll();
        }}
      />
    </main>
  );
}
