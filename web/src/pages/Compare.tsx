import {
  ArrowLeftOutlined,
  DownloadOutlined,
  ExportOutlined,
  FireOutlined,
  LinkOutlined,
  OrderedListOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Tooltip,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type HealthInfo } from '@/services/api';
import { fmtSize, textOf } from '@/utils/format';
import { previewUrl } from './workbench/workbenchModel.js';
import {
  comparisonDefaults,
  comparisonQuery,
  normalizeSystemUrl,
  orderedRange,
} from './compareModel.js';
import styles from './Compare.module.css';

type CompareMode = 'versions' | 'system';

type ComparisonState = {
  mode: CompareMode;
  a: string;
  b: string;
  systemUrl: string;
  showChanges: boolean;
};

const versionNoOf = (version: any) => String(version?.versionNo || version?.no || '');

function requestedMode(params: URLSearchParams): CompareMode {
  return params.get('mode') === 'system' || (!params.get('mode') && params.has('url'))
    ? 'system'
    : 'versions';
}

function countOf(primary: unknown, fallback: unknown[] | undefined) {
  if (typeof primary === 'number') return primary;
  return Array.isArray(fallback) ? fallback.length : 0;
}

const changeMeta: Record<string, { label: string; color: string }> = {
  ADD: { label: '新增', color: 'success' },
  MODIFY: { label: '修改', color: 'warning' },
  REMOVE: { label: '删除', color: 'error' },
};

function ChangeItems({
  items,
  locationCounts = {},
  showHot = false,
}: {
  items: any[];
  locationCounts?: Record<string, number>;
  showHot?: boolean;
}) {
  if (!items.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可展示的变更" />;
  }

  const groups = ['ADD', 'MODIFY', 'REMOVE', 'OTHER']
    .map((type) => ({
      type,
      items: items.filter((item) => (changeMeta[item?.type] ? item.type : 'OTHER') === type),
    }))
    .filter((group) => group.items.length);

  return (
    <div className={styles.changeGroups}>
      {groups.map((group) => {
        const meta = changeMeta[group.type] || { label: '其他', color: 'default' };
        return (
          <section className={styles.changeGroup} key={group.type}>
            <div className={styles.changeGroupHead}>
              <Tag color={meta.color}>{meta.label}</Tag>
              <span>{group.items.length} 条</span>
            </div>
            <div className={styles.changeList}>
              {group.items.map((item, index) => {
                const location = String(item.location || '').trim() || '未标注位置';
                const hotCount = Number(locationCounts[location] || 0);
                return (
                  <article className={styles.changeItem} key={`${group.type}-${item.fromVersionNo || ''}-${index}`}>
                    <div className={styles.changeItemHead}>
                      <strong>{location}</strong>
                      {item.fromVersionNo ? <code>{item.fromVersionNo}</code> : null}
                    </div>
                    <p>{textOf(item.content || item.description || item.title, '未填写变更内容')}</p>
                    <div className={styles.changeItemTags}>
                      {item.requirement ? <Tag>{item.requirement}</Tag> : null}
                      {showHot && hotCount > 2 ? (
                        <Tag color="warning" icon={<FireOutlined />}>
                          区间内修改 {hotCount} 次
                        </Tag>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function Compare() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const paramsRef = useRef(params);
  const setParamsRef = useRef(setParams);
  paramsRef.current = params;
  setParamsRef.current = setParams;

  const mode = requestedMode(params);
  const a = params.get('a') || '';
  const queryB = params.get('b') || '';
  const rawSystemUrl = params.get('url') || '';
  const systemUrl = normalizeSystemUrl(rawSystemUrl, window.location.protocol);
  const showChanges = params.get('changes') !== '0';

  const [project, setProject] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [rightSelection, setRightSelection] = useState(queryB);
  const [systemUrlInput, setSystemUrlInput] = useState(rawSystemUrl);
  const [lastSystemUrl, setLastSystemUrl] = useState(systemUrl);
  const [leftVersion, setLeftVersion] = useState<any>(null);
  const [rightVersion, setRightVersion] = useState<any>(null);
  const [cumulative, setCumulative] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [cumulativeError, setCumulativeError] = useState('');
  const [syncScroll, setSyncScroll] = useState(true);
  const [leftFrameState, setLeftFrameState] = useState<'idle' | 'loading' | 'loaded' | 'timeout'>('idle');
  const [rightFrameState, setRightFrameState] = useState<'idle' | 'loading' | 'loaded' | 'timeout'>('idle');

  const coreRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const scrollARef = useRef<HTMLDivElement>(null);
  const scrollBRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef<'a' | 'b' | null>(null);
  const pendingScrollRef = useRef<{ source: 'a' | 'b'; left: number } | null>(null);
  const syncFrameRef = useRef<number | null>(null);

  const b = queryB || rightSelection;
  const versionOptions = useMemo(
    () => versions.map((item) => ({
      value: versionNoOf(item),
      label: `${versionNoOf(item)} · ${textOf(item.title, '未命名版本')}`,
    })),
    [versions],
  );

  const replaceQuery = useCallback((patch: Partial<ComparisonState>) => {
    const next = {
      mode,
      a,
      b,
      systemUrl,
      showChanges,
      ...patch,
    };
    setParams(comparisonQuery(next), { replace: true });
  }, [a, b, mode, setParams, showChanges, systemUrl]);

  const loadCore = useCallback(async () => {
    if (!slug) return;
    const requestId = ++coreRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const [nextProject, nextVersions, nextHealth] = await Promise.all([
        api.getProject(slug),
        api.listVersions(slug, { includeDraft: true, includeVoid: true }),
        api.health(),
      ]);
      if (requestId !== coreRequestRef.current) return;

      setProject(nextProject);
      setVersions(nextVersions);
      setHealth(nextHealth);

      const current = paramsRef.current;
      const nextMode = requestedMode(current);
      const defaults = comparisonDefaults(
        nextVersions,
        nextProject?.baselineVersionNo || '',
        current.get('a') || '',
        current.get('b') || '',
      );
      const nextSystemUrl = normalizeSystemUrl(current.get('url') || '', window.location.protocol);
      const nextShowChanges = current.get('changes') !== '0';
      setRightSelection(defaults.b);

      const nextQuery = comparisonQuery({
        mode: nextMode,
        a: defaults.a,
        b: defaults.b,
        systemUrl: nextSystemUrl,
        showChanges: nextShowChanges,
      });
      if (nextQuery !== current.toString()) setParamsRef.current(nextQuery, { replace: true });
    } catch (nextError) {
      if (requestId !== coreRequestRef.current) return;
      setError(nextError instanceof Error ? nextError.message : '无法读取对比数据');
    } finally {
      if (requestId === coreRequestRef.current) setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadCore();
    return () => {
      coreRequestRef.current += 1;
    };
  }, [loadCore]);

  useEffect(() => {
    if (queryB) setRightSelection(queryB);
  }, [queryB]);

  useEffect(() => {
    if (rawSystemUrl) {
      setSystemUrlInput(rawSystemUrl);
      if (systemUrl) setLastSystemUrl(systemUrl);
      return;
    }
    if (mode === 'system') {
      setSystemUrlInput('');
      setLastSystemUrl('');
    }
  }, [mode, rawSystemUrl, systemUrl]);

  useEffect(() => {
    const hasLeft = versions.some((item) => versionNoOf(item) === a);
    const hasRight = versions.some((item) => versionNoOf(item) === b);
    const requestId = ++detailRequestRef.current;
    setDetailError('');
    setCumulativeError('');

    if (!slug || !hasLeft || (mode === 'versions' && !hasRight)) {
      setLeftVersion(null);
      setRightVersion(null);
      setCumulative(null);
      setDetailLoading(false);
      return undefined;
    }

    setDetailLoading(true);
    const loadDetails = async () => {
      try {
        if (mode === 'system') {
          const nextLeft = await api.getVersion(slug, a);
          if (requestId !== detailRequestRef.current) return;
          setLeftVersion(nextLeft);
          setRightVersion(null);
          setCumulative(null);
          return;
        }

        const range = orderedRange(versions, a, b);
        const cumulativeRequest = range.older && range.newer && range.older !== range.newer
          ? api.cumulative(slug, range.older, range.newer)
          : Promise.resolve({
            fromVersionNo: range.older,
            toVersionNo: range.newer,
            versionCount: range.older ? 1 : 0,
            itemCount: 0,
            items: [],
            locationCounts: {},
          });
        const [leftResult, rightResult, cumulativeResult] = await Promise.allSettled([
          api.getVersion(slug, a),
          a === b ? api.getVersion(slug, a) : api.getVersion(slug, b),
          cumulativeRequest,
        ]);
        if (requestId !== detailRequestRef.current) return;
        if (leftResult.status === 'rejected') throw leftResult.reason;
        if (rightResult.status === 'rejected') throw rightResult.reason;

        setLeftVersion(leftResult.value);
        setRightVersion(rightResult.value);
        if (cumulativeResult.status === 'fulfilled') {
          setCumulative(cumulativeResult.value);
        } else {
          setCumulative(null);
          setCumulativeError('累计变更读取失败，可重试或继续对照原型');
        }
      } catch (nextError) {
        if (requestId !== detailRequestRef.current) return;
        setLeftVersion(null);
        setRightVersion(null);
        setCumulative(null);
        setDetailError(nextError instanceof Error ? nextError.message : '版本详情读取失败');
      } finally {
        if (requestId === detailRequestRef.current) setDetailLoading(false);
      }
    };

    void loadDetails();
    return () => {
      detailRequestRef.current += 1;
    };
  }, [a, b, mode, slug, versions]);

  useEffect(() => () => {
    if (syncFrameRef.current !== null) window.cancelAnimationFrame(syncFrameRef.current);
  }, []);

  const previewPort = health?.previewPort || 7789;
  const srcA = a ? previewUrl({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    previewPort,
    slug,
    versionNo: a,
  }) : '';
  const srcB = b ? previewUrl({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    previewPort,
    slug,
    versionNo: b,
  }) : '';
  const rightSrc = mode === 'system' ? systemUrl : srcB;
  useEffect(() => {
    setLeftFrameState(srcA ? 'loading' : 'idle');
    setRightFrameState(rightSrc ? 'loading' : 'idle');
    const leftTimer = srcA ? window.setTimeout(() => {
      setLeftFrameState((state) => state === 'loading' ? 'timeout' : state);
    }, 10000) : null;
    const rightTimer = rightSrc ? window.setTimeout(() => {
      setRightFrameState((state) => state === 'loading' ? 'timeout' : state);
    }, 10000) : null;
    return () => {
      if (leftTimer !== null) window.clearTimeout(leftTimer);
      if (rightTimer !== null) window.clearTimeout(rightTimer);
    };
  }, [rightSrc, srcA]);
  const sameVersion = mode === 'versions' && Boolean(a) && a === b;
  const range = orderedRange(versions, a, b);
  const sideNoteTitle = mode === 'system'
    ? `原型 ${a || '-'} / 业务系统`
    : `${range.older || '-'} -> ${range.newer || '-'}`;

  const handleModeChange = (value: string | number) => {
    const nextMode = value === 'system' ? 'system' : 'versions';
    let nextB = b;
    if (nextMode === 'versions' && !nextB) {
      nextB = versionNoOf(versions.find((item) => versionNoOf(item) !== a)) || a;
      setRightSelection(nextB);
    }
    replaceQuery({
      mode: nextMode,
      b: nextB,
      systemUrl: nextMode === 'system' ? lastSystemUrl : systemUrl,
    });
  };

  const handleLeftChange = (value: string) => {
    replaceQuery({ a: value });
  };

  const handleRightChange = (value: string) => {
    setRightSelection(value);
    replaceQuery({ b: value });
  };

  const swap = () => {
    if (!a || !b || mode !== 'versions') return;
    setRightSelection(a);
    replaceQuery({ a: b, b: a });
  };

  const loadSystemUrl = () => {
    const nextUrl = normalizeSystemUrl(systemUrlInput, window.location.protocol);
    if (!nextUrl) {
      message.error('请输入合法的 HTTP 或 HTTPS 地址');
      return;
    }
    setSystemUrlInput(nextUrl);
    setLastSystemUrl(nextUrl);
    replaceQuery({ mode: 'system', systemUrl: nextUrl });
  };

  const openPreview = (src: string) => {
    if (src) window.open(src, '_blank', 'noopener,noreferrer');
  };

  const download = (versionNo: string) => {
    if (versionNo) window.open(api.downloadUrl(slug, versionNo), '_blank', 'noopener,noreferrer');
  };

  const copyCompareLink = async () => {
    const query = comparisonQuery({ mode, a, b, systemUrl, showChanges });
    setParams(query, { replace: true });
    const route = window.location.hash.split('?')[0].replace(/^#/, '');
    const href = `${window.location.origin}${window.location.pathname}#${route}?${query}`;
    try {
      await navigator.clipboard.writeText(href);
      message.success('对比链接已复制');
    } catch {
      message.error('复制失败，可直接复制浏览器地址栏');
    }
  };

  const syncOuterScroll = (source: 'a' | 'b') => {
    if (!syncScroll) return;
    if (programmaticScrollRef.current === source) {
      programmaticScrollRef.current = null;
      return;
    }
    const from = source === 'a' ? scrollARef.current : scrollBRef.current;
    if (!from) return;
    pendingScrollRef.current = { source, left: from.scrollLeft };
    if (syncFrameRef.current !== null) return;
    syncFrameRef.current = window.requestAnimationFrame(() => {
      const pending = pendingScrollRef.current;
      pendingScrollRef.current = null;
      syncFrameRef.current = null;
      if (!pending) return;
      const target = pending.source === 'a' ? scrollBRef.current : scrollARef.current;
      if (!target) return;
      programmaticScrollRef.current = pending.source === 'a' ? 'b' : 'a';
      target.scrollLeft = pending.left;
    });
  };

  const summaryMessage = mode === 'system'
    ? '左侧是本地归档原型，右侧加载真实业务系统。若系统禁止嵌入，请使用新窗口对照。'
    : sameVersion
      ? '左右两侧选择了同一个版本，当前用于核对同一份网页。'
      : '两侧加载归档原型的真实网页，可直接核对视觉与交互差异。';

  return (
    <main className={styles.page}>
      <header className={styles.toolbar}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/projects/${encodeURIComponent(slug)}`)}
        >
          返回
        </Button>
        <div className={styles.toolbarDivider} aria-hidden="true" />
        <div className={styles.title}>
          <strong>{mode === 'system' ? '原型 / 业务系统对比' : '原型版本并排对比'}</strong>
          <span>{project?.name || slug}</span>
        </div>
        <div className={styles.toolbarActions}>
          <Segmented
            size="small"
            value={mode}
            options={[
              { label: '原型对比', value: 'versions' },
              { label: '业务系统', value: 'system' },
            ]}
            onChange={handleModeChange}
          />
          <Tooltip title="同步两侧外层画布的横向位置；网页内部滚动仍由页面自身控制">
            <Checkbox checked={syncScroll} onChange={(event) => setSyncScroll(event.target.checked)}>
              同步视口
            </Checkbox>
          </Tooltip>
          {mode === 'versions' ? (
            <Button size="small" icon={<SwapOutlined />} disabled={!a || !b} onClick={swap}>
              交换
            </Button>
          ) : null}
          <Button
            size="small"
            icon={<OrderedListOutlined />}
            onClick={() => replaceQuery({ showChanges: !showChanges })}
          >
            {showChanges ? '隐藏说明' : '显示说明'}
          </Button>
          <Tooltip title="复制当前对比链接">
            <Button
              type="text"
              size="small"
              icon={<LinkOutlined />}
              aria-label="复制当前对比链接"
              disabled={!a}
              onClick={() => void copyCompareLink()}
            />
          </Tooltip>
        </div>
      </header>

      <section className={styles.summary} aria-label="对比摘要">
        <div className={styles.summaryItem}>
          <span>原型版本</span>
          <strong className={styles.mono}>{a || '-'}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{mode === 'system' ? '原型变更' : '版本跨度'}</span>
          <strong>{mode === 'system' ? countOf(leftVersion?.changeCount, leftVersion?.changes) : cumulative?.versionCount ?? '-'}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{mode === 'system' ? '关联需求' : '累计变更'}</span>
          <strong>{mode === 'system' ? countOf(leftVersion?.requirementCount, leftVersion?.requirements) : cumulative?.itemCount ?? '-'}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{mode === 'system' ? '业务系统' : '右侧版本'}</span>
          <strong>{mode === 'system' ? (systemUrl ? '已填写' : '待填写') : b || '-'}</strong>
        </div>
        <Alert
          className={styles.summaryAlert}
          type={sameVersion ? 'warning' : 'info'}
          showIcon
          message={summaryMessage}
        />
      </section>

      {loading ? (
        <section className={styles.state} aria-label="正在加载对比数据">
          <Skeleton active title paragraph={{ rows: 8 }} />
        </section>
      ) : error ? (
        <section className={styles.state}>
          <Alert
            type="error"
            showIcon
            message="对比数据加载失败"
            description={error}
            action={<Button onClick={() => void loadCore()}>重试</Button>}
          />
        </section>
      ) : !versions.length ? (
        <section className={styles.state}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有可对比的版本" />
        </section>
      ) : (
        <div className={`${styles.body} ${showChanges ? styles.withChanges : ''}`}>
          <div className={styles.stage}>
            <section className={styles.pane} aria-label="左侧原型版本">
              <div className={styles.paneBar}>
                <div className={styles.paneLabel}>
                  <span>左侧版本</span>
                  {leftVersion ? <Tag color={leftVersion.display?.color}>{textOf(leftVersion.display?.label || leftVersion.status)}</Tag> : null}
                </div>
                <Select
                  className={styles.versionPicker}
                  aria-label="选择左侧版本"
                  size="small"
                  value={a || undefined}
                  options={versionOptions}
                  placeholder="选择左侧版本"
                  onChange={handleLeftChange}
                />
                <div className={styles.paneActions}>
                  <Tooltip title="新窗口打开">
                    <Button
                      type="text"
                      size="small"
                      icon={<ExportOutlined />}
                      aria-label="新窗口打开左侧原型"
                      disabled={!srcA}
                      onClick={() => openPreview(srcA)}
                    />
                  </Tooltip>
                  <Tooltip title="下载 HTML">
                    <Button
                      type="text"
                      size="small"
                      icon={<DownloadOutlined />}
                      aria-label="下载左侧版本 HTML"
                      disabled={!a}
                      onClick={() => download(a)}
                    />
                  </Tooltip>
                </div>
              </div>
              <div className={styles.paneMeta}>
                <code>{leftVersion?.versionNo || a}</code>
                <span>{textOf(leftVersion?.title, detailLoading ? '正在读取版本信息' : '未命名版本')}</span>
                {leftVersion ? <span>{fmtSize(leftVersion.fileSize)}</span> : null}
              </div>
              <div
                ref={scrollARef}
                className={styles.previewScroll}
                onScroll={() => syncOuterScroll('a')}
              >
                {srcA ? (
                  <iframe
                    key={`left:${srcA}`}
                    className={styles.frame}
                    title={`原型 ${a}`}
                    src={srcA}
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    referrerPolicy="no-referrer"
                    onLoad={(event) => {
                      if (event.currentTarget.src === srcA) setLeftFrameState('loaded');
                    }}
                    onError={(event) => {
                      if (event.currentTarget.src === srcA) setLeftFrameState('timeout');
                    }}
                  />
                ) : (
                  <div className={styles.frameEmpty}><Empty description="请选择左侧版本" /></div>
                )}
                {leftFrameState === 'loading' ? (
                  <div className={styles.frameNotice}>正在加载左侧原型...</div>
                ) : null}
                {leftFrameState === 'timeout' ? (
                  <div className={styles.frameAlert}>
                    <Alert
                      type="warning"
                      showIcon
                      message="左侧原型加载超时"
                      action={<Button size="small" onClick={() => openPreview(srcA)}>新窗口打开</Button>}
                    />
                  </div>
                ) : null}
              </div>
            </section>

            <div className={styles.paneDivider} aria-hidden="true" />

            <section className={styles.pane} aria-label={mode === 'system' ? '业务系统' : '右侧原型版本'}>
              <div className={styles.paneBar}>
                <div className={styles.paneLabel}>
                  <span>{mode === 'system' ? '业务系统' : '右侧版本'}</span>
                  {mode === 'system' && systemUrl ? <Tag color="cyan">真实页面</Tag> : null}
                  {mode === 'versions' && rightVersion ? (
                    <Tag color={rightVersion.display?.color}>{textOf(rightVersion.display?.label || rightVersion.status)}</Tag>
                  ) : null}
                </div>
                {mode === 'system' ? (
                  <Input.Search
                    className={styles.systemUrlInput}
                    aria-label="业务系统地址"
                    size="small"
                    value={systemUrlInput}
                    placeholder="https://example.com/app/page"
                    enterButton="加载"
                    onChange={(event) => setSystemUrlInput(event.target.value)}
                    onSearch={loadSystemUrl}
                  />
                ) : (
                  <Select
                    className={styles.versionPicker}
                    aria-label="选择右侧版本"
                    size="small"
                    value={b || undefined}
                    options={versionOptions}
                    placeholder="选择右侧版本"
                    onChange={handleRightChange}
                  />
                )}
                <div className={styles.paneActions}>
                  <Tooltip title="新窗口打开">
                    <Button
                      type="text"
                      size="small"
                      icon={<ExportOutlined />}
                      aria-label={mode === 'system' ? '新窗口打开业务系统' : '新窗口打开右侧原型'}
                      disabled={!rightSrc}
                      onClick={() => openPreview(rightSrc)}
                    />
                  </Tooltip>
                  {mode === 'versions' ? (
                    <Tooltip title="下载 HTML">
                      <Button
                        type="text"
                        size="small"
                        icon={<DownloadOutlined />}
                        aria-label="下载右侧版本 HTML"
                        disabled={!b}
                        onClick={() => download(b)}
                      />
                    </Tooltip>
                  ) : null}
                </div>
              </div>
              <div className={styles.paneMeta}>
                {mode === 'system' ? (
                  <span className={styles.breakAll}>
                    {systemUrl || '填写测试、预发或生产业务系统地址后开始对比'}
                  </span>
                ) : (
                  <>
                    <code>{rightVersion?.versionNo || b}</code>
                    <span>{textOf(rightVersion?.title, detailLoading ? '正在读取版本信息' : '未命名版本')}</span>
                    {rightVersion ? <span>{fmtSize(rightVersion.fileSize)}</span> : null}
                  </>
                )}
              </div>
              <div
                ref={scrollBRef}
                className={styles.previewScroll}
                onScroll={() => syncOuterScroll('b')}
              >
                {mode === 'system' && systemUrl ? (
                  <iframe
                    key={`system:${rightSrc}`}
                    className={styles.frame}
                    title="业务系统"
                    src={systemUrl}
                    referrerPolicy="no-referrer-when-downgrade"
                    onLoad={(event) => {
                      if (event.currentTarget.src === rightSrc) setRightFrameState('loaded');
                    }}
                    onError={(event) => {
                      if (event.currentTarget.src === rightSrc) setRightFrameState('timeout');
                    }}
                  />
                ) : mode === 'versions' && srcB ? (
                  <iframe
                    key={`right:${rightSrc}`}
                    className={styles.frame}
                    title={`原型 ${b}`}
                    src={srcB}
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    referrerPolicy="no-referrer"
                    onLoad={(event) => {
                      if (event.currentTarget.src === rightSrc) setRightFrameState('loaded');
                    }}
                    onError={(event) => {
                      if (event.currentTarget.src === rightSrc) setRightFrameState('timeout');
                    }}
                  />
                ) : (
                  <div className={styles.frameEmpty}>
                    <Empty description={mode === 'system' ? '请输入真实业务系统地址' : '请选择右侧版本'} />
                  </div>
                )}
                {rightFrameState === 'loading' ? (
                  <div className={styles.frameNotice}>正在加载右侧页面...</div>
                ) : null}
                {rightFrameState === 'timeout' ? (
                  <div className={styles.frameAlert}>
                    <Alert
                      type="warning"
                      showIcon
                      message={mode === 'system' ? '业务系统加载超时或禁止嵌入' : '右侧原型加载超时'}
                      action={<Button size="small" onClick={() => openPreview(rightSrc)}>新窗口打开</Button>}
                    />
                  </div>
                ) : null}
              </div>
            </section>

            {detailLoading ? <div className={styles.loadingOverlay}>正在读取版本信息...</div> : null}
            {detailError ? (
              <Alert
                className={styles.detailAlert}
                type="error"
                showIcon
                message="版本详情读取失败"
                description={detailError}
              />
            ) : null}
          </div>

          {showChanges ? (
            <aside className={styles.changes} aria-label={mode === 'system' ? '对比说明' : '累计变更'}>
              <div className={styles.changesHead}>
                <div>
                  <strong>{mode === 'system' ? '对比说明' : '累计变更'}</strong>
                  <div className={styles.sideNote}>{sideNoteTitle}</div>
                </div>
                <Tooltip title="复制当前对比链接">
                  <Button
                    size="small"
                    icon={<LinkOutlined />}
                    aria-label="复制当前对比链接"
                    disabled={!a}
                    onClick={() => void copyCompareLink()}
                  />
                </Tooltip>
              </div>
              {detailError ? <Alert className={styles.panelAlert} type="error" showIcon message={detailError} /> : null}
              {mode === 'system' ? (
                <>
                  <Alert
                    className={styles.panelAlert}
                    type="warning"
                    showIcon
                    message="业务系统可能禁止嵌入"
                    description="页面按原地址直接加载且不加沙箱。若 X-Frame-Options 或 CSP 阻止显示，请使用新窗口对照。"
                  />
                  <div className={styles.sectionLabel}>原型变更清单</div>
                  <ChangeItems items={leftVersion?.changes || []} />
                </>
              ) : (
                <>
                  {cumulativeError ? <Alert className={styles.panelAlert} type="warning" showIcon message={cumulativeError} /> : null}
                  <ChangeItems
                    items={cumulative?.items || []}
                    locationCounts={cumulative?.locationCounts || {}}
                    showHot
                  />
                </>
              )}
            </aside>
          ) : null}
        </div>
      )}
    </main>
  );
}
