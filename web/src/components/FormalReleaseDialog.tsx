import {
  Alert,
  App,
  Button,
  Descriptions,
  Divider,
  Modal,
  Radio,
  Result,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleOutlined, MailOutlined, ReloadOutlined } from '@ant-design/icons';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import {
  applyCandidate,
  candidateBlockers,
  initialReleaseRecipients,
  preflightPayload,
  releaseOutcome,
} from './formalReleaseModel.js';

type FormalReleaseDialogProps = {
  open: boolean;
  milestone: string;
  slug: string;
  project: any;
  version: any;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

type RunOptions = {
  nextTo?: string[];
  nextCc?: string[];
  nextSelections?: Record<string, string>;
  releasedAt?: string;
};

function markdownHtml(markdown: string) {
  const html = marked.parse(markdown || '', { async: false, gfm: true, breaks: true });
  return { __html: DOMPurify.sanitize(String(html)) };
}

function blockerSummary(blocker: any) {
  return blocker.hint ? `${blocker.message}（${blocker.hint}）` : blocker.message;
}

export function FormalReleaseDialog({
  open,
  milestone,
  slug,
  project,
  version,
  onClose,
  onChanged,
}: FormalReleaseDialogProps) {
  const { message } = App.useApp();
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [preflight, setPreflight] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [executing, setExecuting] = useState(false);
  const requestIdRef = useRef(0);
  const versionNo = String(version?.versionNo || '');
  const projectDefaultsKey = JSON.stringify(project?.releaseMail || {});

  const runPreflight = useCallback(async ({
    nextTo = to,
    nextCc = cc,
    nextSelections = selections,
    releasedAt = preflight?.releasedAt,
  }: RunOptions = {}) => {
    if (!milestone || !slug || !versionNo) return;
    const requestId = ++requestIdRef.current;
    setChecking(true);
    setError('');
    try {
      const next = await api.preflightMilestoneFormalRelease(
        milestone,
        slug,
        versionNo,
        preflightPayload({
          to: nextTo,
          cc: nextCc,
          selections: nextSelections,
          releasedAt,
        }),
      );
      if (requestId === requestIdRef.current) setPreflight(next);
    } catch (nextError) {
      if (requestId === requestIdRef.current) setError(errorText(nextError, '正式发版预检失败'));
    } finally {
      if (requestId === requestIdRef.current) setChecking(false);
    }
  }, [cc, milestone, preflight?.releasedAt, selections, slug, to, versionNo]);

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      return;
    }
    const recipients = initialReleaseRecipients(project || {});
    setTo(recipients.to);
    setCc(recipients.cc);
    setSelections({});
    setPreflight(null);
    setResult(null);
    setError('');
    void runPreflight({
      nextTo: recipients.to,
      nextCc: recipients.cc,
      nextSelections: {},
      releasedAt: '',
    });
  }, [milestone, open, projectDefaultsKey, slug, versionNo]);

  const changeRecipients = (kind: 'to' | 'cc', values: string[]) => {
    if (kind === 'to') setTo(values);
    else setCc(values);
    setSelections({});
    setPreflight(null);
    setResult(null);
  };

  const chooseCandidate = (query: string, key: string) => {
    const nextSelections = applyCandidate(selections, query, key);
    setSelections(nextSelections);
    void runPreflight({ nextSelections, releasedAt: preflight?.releasedAt });
  };

  const execute = async () => {
    if (!preflight?.ready) return;
    setExecuting(true);
    setError('');
    try {
      const next = await api.formalReleaseMilestoneVersion(
        milestone,
        slug,
        versionNo,
        preflightPayload({
          to,
          cc,
          selections,
          releasedAt: preflight.releasedAt,
        }),
      );
      setResult(next);
      await onChanged();
      if (next.status === 'complete') message.success('正式发版和企业微信邮件均已完成');
      if (next.status === 'mail_pending') message.warning('版本已发版，企业微信邮件进入待重试队列');
      if (next.status === 'git_failed') message.error('基线已更新，但 Git 同步失败，尚未发送邮件');
    } catch (nextError) {
      setError(errorText(nextError, '正式发版失败'));
    } finally {
      setExecuting(false);
    }
  };

  const retryMail = async () => {
    if (!result?.mail?.id) return;
    setExecuting(true);
    setError('');
    try {
      const next = await api.retryReleaseMail(result.mail.id);
      setResult(next);
      await onChanged();
      if (next.status === 'complete') message.success('企业微信发版邮件已发送');
      else message.warning('邮件仍未发送，请按错误提示检查企业微信授权');
    } catch (nextError) {
      setError(errorText(nextError, '邮件重试失败'));
    } finally {
      setExecuting(false);
    }
  };

  const outcome = result ? releaseOutcome(result) : null;
  const ambiguous = candidateBlockers(preflight || {});
  const ordinaryBlockers = (preflight?.blockers || []).filter(
    (item: any) => item.code !== 'RELEASE_RECIPIENT_AMBIGUOUS',
  );
  const preview = useMemo(() => markdownHtml(preflight?.markdown || ''), [preflight?.markdown]);
  const steps = useMemo(() => {
    if (result?.status === 'complete') return [
      { title: '设为基线', status: 'finish' as const },
      { title: '同步 Git', status: 'finish' as const },
      { title: '发送邮件', status: 'finish' as const },
    ];
    if (result?.status === 'mail_pending') return [
      { title: '设为基线', status: 'finish' as const },
      { title: '同步 Git', status: 'finish' as const },
      { title: '发送邮件', status: 'error' as const },
    ];
    if (result?.status === 'git_failed') return [
      { title: '设为基线', status: 'finish' as const },
      { title: '同步 Git', status: 'error' as const },
      { title: '发送邮件', status: 'wait' as const },
    ];
    return [
      { title: '设为基线', status: 'process' as const },
      { title: '同步 Git', status: 'wait' as const },
      { title: '发送邮件', status: 'wait' as const },
    ];
  }, [result?.status]);

  const handleOk = () => {
    if (result?.status === 'complete') return onClose();
    if (result?.status === 'mail_pending') return void retryMail();
    return void execute();
  };

  const okText = result?.status === 'complete'
    ? '完成'
    : result?.status === 'mail_pending'
      ? '重试邮件'
      : result?.status === 'git_failed'
        ? '继续 Git 同步'
        : '确认正式发版';

  return (
    <Modal
      className="fl-formal-release-modal"
      title={`正式发版 · ${versionNo || '未选择版本'}`}
      open={open}
      width={880}
      destroyOnHidden
      confirmLoading={executing}
      okText={okText}
      cancelText={result?.status === 'complete' ? '关闭' : '取消'}
      okButtonProps={{
        disabled: executing || checking || (!result && !preflight?.ready),
        icon: result?.status === 'complete' ? <CheckCircleOutlined /> : <MailOutlined />,
      }}
      closable={!executing}
      maskClosable={!executing}
      onOk={handleOk}
      onCancel={onClose}
    >
      <Steps className="fl-formal-release-steps" responsive={false} size="small" items={steps} />

      {error ? <Alert className="fl-formal-release-alert" type="error" showIcon message="操作失败" description={error} role="alert" /> : null}

      {outcome ? (
        <Result
          className="fl-formal-release-result"
          status={outcome.kind === 'complete' ? 'success' : outcome.kind === 'mail-pending' ? 'warning' : 'error'}
          title={outcome.title}
          subTitle={outcome.description}
          extra={result?.mail?.lastInstruction ? <Alert type="info" message={result.mail.lastInstruction} showIcon /> : null}
        />
      ) : (
        <div className="fl-formal-release-grid" aria-busy={checking}>
          <section className="fl-formal-release-controls" aria-labelledby="release-recipients-title">
            <div className="fl-formal-release-section-head">
              <div>
                <Typography.Title level={5} id="release-recipients-title">收件人</Typography.Title>
                <Typography.Text type="secondary">本次调整不会覆盖项目默认配置。</Typography.Text>
              </div>
              <Button
                icon={<ReloadOutlined />}
                loading={checking}
                disabled={executing}
                onClick={() => void runPreflight({ releasedAt: preflight?.releasedAt })}
              >
                重新预检
              </Button>
            </div>
            <label className="fl-formal-release-field">
              <span>发送给</span>
              <Select
                mode="tags"
                value={to}
                tokenSeparators={[',', '，']}
                placeholder="输入企业微信成员姓名"
                aria-label="本次发版邮件收件人"
                disabled={checking || executing}
                onChange={(values) => changeRecipients('to', values)}
              />
            </label>
            <label className="fl-formal-release-field">
              <span>抄送</span>
              <Select
                mode="tags"
                value={cc}
                tokenSeparators={[',', '，']}
                placeholder="可选"
                aria-label="本次发版邮件抄送人"
                disabled={checking || executing}
                onChange={(values) => changeRecipients('cc', values)}
              />
            </label>

            {ambiguous.map((blocker: any) => (
              <fieldset className="fl-release-candidate-group" key={blocker.query}>
                <legend>请选择“{blocker.query}”对应的成员</legend>
                <Radio.Group
                  value={selections[blocker.query]}
                  aria-label={`选择企业微信成员 ${blocker.query}`}
                  disabled={checking || executing}
                  onChange={(event) => chooseCandidate(blocker.query, event.target.value)}
                >
                  <Space direction="vertical" size={8}>
                    {(blocker.candidates || []).map((candidate: any) => (
                      <Radio value={candidate.key} key={candidate.key}>
                        <strong>{candidate.name}</strong>
                        {candidate.alias ? ` · ${candidate.alias}` : ''}
                        <span className="fl-release-candidate-meta">
                          {[...(candidate.departments || []), candidate.position].filter(Boolean).join(' · ') || '未提供部门信息'}
                        </span>
                      </Radio>
                    ))}
                  </Space>
                </Radio.Group>
              </fieldset>
            ))}

            {ordinaryBlockers.length ? (
              <Alert
                type="error"
                showIcon
                message="正式发版预检未通过"
                description={(
                  <ul className="fl-formal-release-errors">
                    {ordinaryBlockers.map((blocker: any, index: number) => (
                      <li key={`${blocker.code}-${index}`}>{blockerSummary(blocker)}</li>
                    ))}
                  </ul>
                )}
                role="alert"
              />
            ) : null}

            {preflight?.ready ? (
              <Alert type="success" showIcon message="预检通过" description="确认后将依次设置基线、同步 Git、发送邮件。" />
            ) : null}
          </section>

          <section className="fl-formal-release-preview" aria-labelledby="release-preview-title">
            <Typography.Title level={5} id="release-preview-title">邮件预览</Typography.Title>
            {preflight ? (
              <>
                <Descriptions size="small" bordered column={1}>
                  <Descriptions.Item label="项目">{preflight.project?.name || project?.name || slug}</Descriptions.Item>
                  <Descriptions.Item label="版本"><span className="fl-mono">{versionNo}</span> · {version?.title || '未命名版本'}</Descriptions.Item>
                  <Descriptions.Item label="上一基线">{preflight.previousBaseline || '无'}</Descriptions.Item>
                  <Descriptions.Item label="授权状态">
                    <Tag color={preflight.authStatus?.authorized ? 'success' : 'error'}>
                      {preflight.authStatus?.message || '尚未检查'}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="收件人">
                    <Space size={[4, 4]} wrap>
                      {(preflight.to || []).map((recipient: any) => (
                        <Tag key={`to-${recipient.key || recipient.name}`}>
                          {recipient.name}{recipient.departments?.length ? ` · ${recipient.departments.join('/')}` : ''}
                        </Tag>
                      ))}
                    </Space>
                  </Descriptions.Item>
                  {preflight.cc?.length ? (
                    <Descriptions.Item label="抄送">
                      <Space size={[4, 4]} wrap>
                        {preflight.cc.map((recipient: any) => (
                          <Tag key={`cc-${recipient.key || recipient.name}`}>
                            {recipient.name}{recipient.departments?.length ? ` · ${recipient.departments.join('/')}` : ''}
                          </Tag>
                        ))}
                      </Space>
                    </Descriptions.Item>
                  ) : null}
                  <Descriptions.Item label="主题">{preflight.subject || '模板尚未生成主题'}</Descriptions.Item>
                </Descriptions>
                <Divider orientation="left">Markdown 正文</Divider>
                {preflight.markdown ? (
                  <div className="fl-release-preview-markdown" dangerouslySetInnerHTML={preview} />
                ) : (
                  <Alert type="info" message="修复预检问题后显示最终邮件正文" />
                )}
              </>
            ) : (
              <div className="fl-formal-release-loading">
                <Typography.Text type="secondary">{checking ? '正在检查 Git、企业微信授权和收件人…' : '修改收件人后请重新预检。'}</Typography.Text>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
