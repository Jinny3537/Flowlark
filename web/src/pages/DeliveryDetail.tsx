import { Link, useParams } from 'react-router-dom';
import { Alert, App, Button, Checkbox, Col, Collapse, Descriptions, Form, Input, List, Modal, Row, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api, type DeliveryAcceptance, type DeliveryFeedback } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { acceptanceInput, deliveryWriteGuard, verdictLabels } from './deliveryAcceptanceModel.js';

const { Text, Paragraph } = Typography;
const verdictColors: Record<string, string> = { approved: 'success', rejected: 'error', conditional: 'warning', waived: 'processing', pending: 'default' };
const severityLabels: Record<string, string> = { blocker: '阻断', important: '重要', normal: '一般' };
const fullWidth = { width: '100%', minWidth: 0 };
const wrapped = { minWidth: 0, overflowWrap: 'anywhere' as const };
const requiredText = [{ required: true, whitespace: true, message: '请填写此项' }];

function Verdict({ value }: { value: string }) {
  return <Tag color={verdictColors[value] || 'default'}>{verdictLabels[value] || value}</Tag>;
}

function Conditions({ items = [] }: { items?: Array<{ id: string; text: string; closed: boolean }> }) {
  if (!items.length) return null;
  return <ul style={{ paddingInlineStart: 'var(--fl-s-5)', marginBlock: 'var(--fl-s-2)' }}>
    {items.map((condition) => <li key={condition.id} style={wrapped}>
      <Text type={condition.closed ? 'secondary' : undefined}>{condition.closed ? '已关闭' : '待关闭'} · {condition.text}</Text>
    </li>)}
  </ul>;
}

export default function DeliveryDetail() {
  const { name = '' } = useParams();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const [item, setItem] = useState<any>(null);
  const [acceptance, setAcceptance] = useState<DeliveryAcceptance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acceptanceError, setAcceptanceError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [resolving, setResolving] = useState<DeliveryFeedback | null>(null);
  const [decisionForm] = Form.useForm();
  const [feedbackForm] = Form.useForm();
  const [resolutionForm] = Form.useForm();
  const verdict = Form.useWatch('verdict', decisionForm);
  const currentName = useRef(name);
  currentName.current = name;
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setItem(null);
    setAcceptance(null);
    setError('');
    setAcceptanceError('');
    setMutationError('');
    try {
      const snapshot = await api.getSnapshot(name);
      if (sequence !== loadSequence.current || currentName.current !== name) return;
      setItem(snapshot);
      if (snapshot.kind === 'delivery') {
        try {
          const result = await api.deliveryAcceptance(name);
          if (sequence === loadSequence.current && currentName.current === name) setAcceptance(result);
        } catch (nextError) {
          if (sequence === loadSequence.current && currentName.current === name) setAcceptanceError(errorText(nextError, '无法核验交付材料及验收记录'));
        }
      }
    } catch (nextError) {
      if (sequence === loadSequence.current && currentName.current === name) setError(errorText(nextError, '无法读取交付快照'));
    } finally {
      if (sequence === loadSequence.current && currentName.current === name) setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    decisionForm.resetFields();
    setFeedbackOpen(false);
    setResolving(null);
    void load();
    return () => { loadSequence.current += 1; };
  }, [load, decisionForm]);

  const formal = item?.kind === 'delivery';
  const roles = acceptance?.roles || item?.acceptance?.roles || [];
  const guard = deliveryWriteGuard({
    kind: item?.kind, canWrite: health?.canWrite, readonlyReason: health?.readonlyReason,
    integrityReady: acceptance?.integrity?.ready, snapshotHash: acceptance?.snapshotHash, loading,
  });
  const disabled = Boolean(guard) || saving;

  const mutate = async (operation: () => Promise<unknown>, success: string, onSaved: () => void) => {
    if (disabled) return;
    setSaving(true);
    setMutationError('');
    try {
      await operation();
      message.success(success);
      if (currentName.current !== name) return;
      onSaved();
      try {
        const result = await api.deliveryAcceptance(name);
        if (currentName.current === name) { setAcceptance(result); setAcceptanceError(''); }
      } catch (nextError) {
        if (currentName.current === name) {
          setAcceptance(null);
          setAcceptanceError(`操作已保存，但刷新失败：${errorText(nextError, '请重新加载详情')}`);
        }
      }
    } catch (nextError) {
      const detail = errorText(nextError, '操作失败，请重试');
      if (currentName.current === name) setMutationError(detail);
      message.error(detail);
    } finally { setSaving(false); }
  };

  const submitDecision = async (values: any) => {
    if (disabled) return;
    try {
      const payload = acceptanceInput(values, roles, acceptance?.snapshotHash);
      await mutate(() => api.recordAcceptance(name, payload), '已追加验收记录', () => decisionForm.resetFields());
    } catch (nextError) { setMutationError(errorText(nextError, '请检查验收表单')); }
  };

  const chooseRole = (roleId: string) => {
    const latest = roles.find((role: any) => role.id === roleId)?.latest;
    decisionForm.setFieldsValue(latest?.verdict === 'conditional'
      ? { verdict: 'conditional', note: '', conditions: latest.conditions.map((condition: any) => ({ ...condition })) }
      : { verdict: 'approved', note: '', conditions: [] });
  };

  return (
    <main className="fl-page fl-delivery-detail" style={wrapped}>
      <style>{`
        .fl-delivery-detail .ant-btn, .fl-delivery-dialog .ant-btn { min-height: 44px; height: auto; white-space: normal; }
        .fl-delivery-detail .ant-select-single, .fl-delivery-dialog .ant-select-single { height: 44px; }
        .fl-delivery-detail .ant-input, .fl-delivery-dialog .ant-input { min-height: 44px; }
        .fl-delivery-detail .ant-checkbox-wrapper { min-height: 44px; display: inline-flex; align-items: center; }
        .fl-delivery-detail .ant-space-item, .fl-delivery-dialog .ant-space-item { min-width: 0; max-width: 100%; }
        .fl-delivery-detail .ant-tag { white-space: normal; }
        .fl-delivery-detail .ant-descriptions-item-content { overflow-wrap: anywhere; }
        .fl-delivery-dialog .ant-modal-content { overflow-wrap: anywhere; }
      `}</style>
      <PageHeader eyebrow="交付详情" title={item?.title || name}
        description={formal ? '以冻结的交付材料为依据，记录角色验收与反馈处理。' : '查看快照及其冻结版本范围。'} backTo="/deliveries"
        actions={<Button icon={<ReloadOutlined />} onClick={load} loading={loading} disabled={saving}>刷新</Button>} />
      <State loading={loading} error={error} onRetry={load} empty={!item} emptyText="没有找到交付快照">
        <div className="fl-detail-stack" style={wrapped}>
          {!formal && <Alert type="info" showIcon message="历史快照 · 不支持正式验收" description="此快照没有正式发版时冻结的验收规则与完整材料证据。请从迭代正式发版生成新的交付快照后再验收。" />}
          {formal && guard && <Alert type="warning" showIcon message="当前仅可查看交付" description={guard} />}
          {acceptanceError && <Alert type="error" showIcon message="验收信息暂不可用" description={acceptanceError} action={<Button onClick={load}>重新加载</Button>} />}
          {mutationError && <Alert type="error" showIcon message="操作未完成" description={mutationError} />}
          <section className="fl-detail-summary">
            <Descriptions column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="标识"><span className="fl-mono" style={wrapped}>{name}</span></Descriptions.Item>
              <Descriptions.Item label="状态">{formal ? acceptance ? <Verdict value={acceptance.status} /> : <Tag>等待核验</Tag> : <Tag>历史快照</Tag>}</Descriptions.Item>
              <Descriptions.Item label="创建人">{textOf(item?.createdBy)}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{fmtTime(item?.createdAt)}</Descriptions.Item>
              {item?.milestone && <Descriptions.Item label="所属迭代"><Link to={`/milestones/${encodeURIComponent(item.milestone)}`}>{item.milestone}</Link></Descriptions.Item>}
              {formal && <Descriptions.Item label="材料完整性">{acceptance?.integrity?.ready ? <Tag icon={<CheckCircleOutlined />} color="success">校验通过 · {acceptance.integrity.materialCount ?? item?.materials?.length ?? 0} 项材料</Tag> : <Tag color="warning">尚未通过校验</Tag>}</Descriptions.Item>}
              {formal && <Descriptions.Item label="发版提交" span={2}><span className="fl-mono" style={wrapped}>{item?.releaseCommit}</span></Descriptions.Item>}
            </Descriptions>
          </section>

          {formal && <Row gutter={[16, 16]}>
            <Col xs={24} xl={14} style={wrapped}>
              <section className="fl-detail-section">
                <h2>冻结验收规则</h2>
                <Paragraph type="secondary">所有必选角色均通过、豁免或关闭全部条件，且阻断反馈清零后，验收才算通过。规则以本次交付快照为准。</Paragraph>
                {acceptance?.blockers?.length ? <Alert type={acceptance.status === 'rejected' ? 'error' : 'warning'} showIcon
                  message={acceptance.status === 'rejected' ? '验收已拒绝' : '验收尚未完成'}
                  description={<ul style={{ paddingInlineStart: 'var(--fl-s-4)', margin: 0 }}>{acceptance.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}</li>)}</ul>} />
                  : acceptance?.ready ? <Alert type="success" showIcon message="验收通过" description="本次交付的角色验收与反馈门禁已满足。外部任务回写和迭代归档仍需在迭代中完成。" /> : null}
                <List dataSource={roles} rowKey="id" locale={{ emptyText: '没有可用的冻结角色信息' }} renderItem={(role: any) => <List.Item><div style={fullWidth}>
                  <Space wrap><Text strong>{role.name}</Text><Tag>{role.required ? '必选' : '可选 · 不阻断'}</Tag><Verdict value={role.latest?.verdict || 'pending'} /></Space>
                  {role.latest && <div><Text type="secondary">{textOf(role.latest.actor)} · {fmtTime(role.latest.at)}</Text></div>}
                  {role.latest?.note && <Paragraph style={{ marginBlock: 'var(--fl-s-2)' }}>{role.latest.note}</Paragraph>}
                  <Conditions items={role.latest?.conditions} />
                </div></List.Item>} />
              </section>
            </Col>
            <Col xs={24} xl={10} style={wrapped}>
              <section className="fl-detail-section">
                <h2>追加验收结论</h2>
                <Paragraph type="secondary">每次提交都会保留操作者和时间。后续修改或关闭条件时，追加一条新记录。</Paragraph>
                <Form name="delivery-acceptance" form={decisionForm} layout="vertical" disabled={disabled} initialValues={{ verdict: 'approved', conditions: [] }} onFinish={submitDecision} scrollToFirstError>
                  <Form.Item name="role" label="验收角色" rules={[{ required: true, message: '请选择验收角色' }]}>
                    <Select placeholder="请选择本次验收角色" onChange={chooseRole} options={roles.map((role: any) => ({ value: role.id, label: `${role.name}${role.required ? '（必选）' : '（可选）'}` }))} />
                  </Form.Item>
                  <Form.Item name="verdict" label="验收结论" rules={[{ required: true }]}><Select options={Object.entries(verdictLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
                  {verdict === 'conditional' && <Form.List name="conditions" rules={[{ validator: async (_, conditions) => { if (!conditions?.length) throw new Error('请至少添加一个验收条件'); } }]}>
                    {(fields, { add, remove }, { errors }) => <div>
                      <Paragraph type="secondary">全部条件勾选“已关闭”后，本角色才按通过计算。</Paragraph>
                      {fields.map((field, index) => <div key={field.key}>
                        <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
                        <Form.Item name={[field.name, 'text']} label={`条件 ${index + 1}`} rules={[...requiredText, { max: 2000 }]}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
                        <Space wrap style={{ marginBottom: 'var(--fl-s-3)' }}>
                          <Form.Item name={[field.name, 'closed']} valuePropName="checked" style={{ marginBottom: 0 }}><Checkbox>已关闭</Checkbox></Form.Item>
                          <Button type="text" onClick={() => remove(field.name)} aria-label={`移除条件 ${index + 1}`}>移除此条件</Button>
                        </Space>
                      </div>)}
                      <Button type="dashed" block icon={<PlusOutlined />} disabled={disabled || fields.length >= 100} onClick={() => add({ id: `condition-${crypto.randomUUID()}`, text: '', closed: false })}>添加验收条件</Button>
                      <Form.ErrorList errors={errors} />
                    </div>}
                  </Form.List>}
                  <Form.Item name="note" label={verdict === 'waived' ? '豁免原因' : '验收备注'} rules={verdict === 'waived' ? [...requiredText, { max: 10000 }] : [{ max: 10000 }]} style={{ marginTop: 'var(--fl-s-4)' }}>
                    <Input.TextArea rows={3} maxLength={10000} placeholder={verdict === 'waived' ? '说明本次无需验收的原因' : '记录验证范围、发现或结论依据'} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={saving} disabled={disabled}>提交验收记录</Button>
                </Form>
              </section>
            </Col>
          </Row>}

          {formal && <section className="fl-detail-section">
            <div className="fl-section-head" style={{ flexWrap: 'wrap' }}>
              <div><h2>交付反馈</h2><Text type="secondary">阻断反馈必须解决后才能完成验收；解决记录保留原因、处理人和时间。</Text></div>
              <Button icon={<PlusOutlined />} disabled={disabled} onClick={() => { feedbackForm.resetFields(); setFeedbackOpen(true); }}>记录反馈</Button>
            </div>
            <List dataSource={acceptance?.feedback || []} rowKey="id" locale={{ emptyText: acceptanceError ? '反馈暂不可用，请重新加载' : '暂无交付反馈' }} renderItem={(feedback) => <List.Item><div style={fullWidth}>
              <Space wrap><Text strong>{feedback.title}</Text><Tag color={feedback.severity === 'blocker' ? 'error' : feedback.severity === 'important' ? 'warning' : 'default'}>{severityLabels[feedback.severity]}</Tag><Tag color={feedback.status === 'resolved' ? 'success' : 'default'}>{feedback.status === 'resolved' ? '已解决' : '待处理'}</Tag></Space>
              <Paragraph style={{ marginBlock: 'var(--fl-s-2)', whiteSpace: 'pre-wrap' }}>{feedback.description}</Paragraph>
              <Space wrap><Text type="secondary">{textOf(feedback.actor)} · {fmtTime(feedback.at)}</Text>{feedback.requirement && <Link to={`/requirements/${encodeURIComponent(feedback.requirement)}`}>{feedback.requirement}</Link>}</Space>
              {feedback.resolution ? <Paragraph style={{ marginTop: 'var(--fl-s-2)', marginBottom: 0 }}><Text strong>解决原因：</Text>{feedback.resolution.reason}<br /><Text type="secondary">{textOf(feedback.resolution.actor)} · {fmtTime(feedback.resolution.at)}</Text></Paragraph>
                : <div style={{ marginTop: 'var(--fl-s-3)' }}><Button disabled={disabled} onClick={() => { resolutionForm.resetFields(); setResolving(feedback); }}>解决反馈</Button></div>}
            </div></List.Item>} />
          </section>}

          <section className="fl-detail-section">
            <h2>冻结版本</h2>
            <List locale={{ emptyText: '快照中没有冻结版本' }} dataSource={item?.items || []} renderItem={(entry: any) => <List.Item><Space wrap><Text>{entry.project} / {entry.version}</Text>{entry.requirement && <Tag>{entry.requirement}</Tag>}</Space></List.Item>} />
            {formal && <Collapse items={[{ key: 'materials', label: `交付材料（${item?.materials?.length || 0} 项）`, children: <>
              <Paragraph type="secondary">下列文件与规格书在正式发版时冻结。完整性结论来自服务端对冻结内容的校验。</Paragraph>
              <List dataSource={item?.materials || []} renderItem={(material: any, index) => <List.Item><Space wrap><span className="fl-mono" style={wrapped}>{material.path}</span><Text type="secondary">{material.size} 字节</Text><a href={`/api/snapshots/${encodeURIComponent(name)}/materials/${index}`} download>下载冻结材料</a></Space></List.Item>} />
              {item?.specification && <><h3>冻结规格书</h3><Paragraph style={{ whiteSpace: 'pre-wrap', ...wrapped }}>{item.specification}</Paragraph></>}
            </> }]} />}
          </section>

          {formal && <section className="fl-detail-section">
            <h2>需求池来源</h2>
            <Paragraph type="secondary">以下来源摘要冻结于正式发版提交，用于追溯交付范围对应的外部需求池对象。</Paragraph>
            <List dataSource={item?.requirementSources || []} locale={{ emptyText: '本次交付没有外部需求池来源摘要' }} renderItem={(source: any) => <List.Item>
              <Space wrap>
                <Link to={`/requirements/${encodeURIComponent(source.code)}`}>{source.code}</Link>
                <Text>{source.title}</Text>
                <Tag color={source.source === 'requirement-pool' ? 'blue' : 'default'}>{source.source === 'requirement-pool' ? '需求池' : '本地'}</Tag>
                {source.key && <Text type="secondary">外部 ID：<span className="fl-mono">{source.key}</span></Text>}
                {source.status && <Tag>{source.status}</Tag>}
                {source.syncedAt && <Text type="secondary">同步于 {fmtTime(source.syncedAt)}</Text>}
                {source.url && <a href={source.url} target="_blank" rel="noreferrer">打开来源</a>}
              </Space>
            </List.Item>} />
          </section>}

          {formal && <section className="fl-detail-section">
            <h2>验收历史</h2>
            <List dataSource={[...(acceptance?.records || [])].reverse()} rowKey="id" locale={{ emptyText: acceptanceError ? '验收历史暂不可用，请重新加载' : '还没有验收记录' }} renderItem={(record) => <List.Item><div style={fullWidth}>
              <Space wrap><Text strong>{roles.find((role: any) => role.id === record.role)?.name || record.role}</Text><Verdict value={record.verdict} /><Text type="secondary">{textOf(record.actor)} · {fmtTime(record.at)}</Text></Space>
              {record.note && <Paragraph style={{ marginBlock: 'var(--fl-s-2)', whiteSpace: 'pre-wrap' }}>{record.note}</Paragraph>}
              <Conditions items={record.conditions} />
            </div></List.Item>} />
          </section>}
        </div>
      </State>

      {formal && <>
        <Modal rootClassName="fl-delivery-dialog" title="记录交付反馈" open={feedbackOpen} onCancel={() => setFeedbackOpen(false)} footer={null} destroyOnHidden>
          <Form form={feedbackForm} name="delivery-feedback" layout="vertical" disabled={disabled} initialValues={{ severity: 'normal' }} scrollToFirstError
            onFinish={(values) => mutate(() => api.createDeliveryFeedback(name, values), '已记录交付反馈', () => setFeedbackOpen(false))}>
            <Form.Item name="title" label="反馈标题" rules={[...requiredText, { max: 200 }]}><Input maxLength={200} /></Form.Item>
            <Form.Item name="severity" label="严重度" rules={[{ required: true }]}><Select options={Object.entries(severityLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
            <Form.Item name="description" label="反馈说明" rules={[...requiredText, { max: 10000 }]}><Input.TextArea rows={4} maxLength={10000} /></Form.Item>
            <Form.Item name="requirement" label="关联需求（可选）"><Select allowClear placeholder="选择本次交付范围内的需求" options={(item?.requirements || []).map((requirement: any) => ({ value: requirement.code, label: `${requirement.code} · ${requirement.title}` }))} /></Form.Item>
            <Space wrap><Button type="primary" htmlType="submit" loading={saving} disabled={disabled}>保存反馈</Button><Button onClick={() => setFeedbackOpen(false)} disabled={saving}>取消</Button></Space>
          </Form>
        </Modal>
        <Modal rootClassName="fl-delivery-dialog" title="解决交付反馈" open={Boolean(resolving)} onCancel={() => setResolving(null)} footer={null} destroyOnHidden>
          <Paragraph style={wrapped}>{resolving?.title}</Paragraph>
          <Form form={resolutionForm} name="delivery-feedback-resolution" layout="vertical" disabled={disabled} scrollToFirstError
            onFinish={(values) => resolving && mutate(() => api.resolveDeliveryFeedback(name, resolving.id, values.reason), '反馈已解决', () => setResolving(null))}>
            <Form.Item name="reason" label="解决原因" rules={[...requiredText, { max: 10000 }]}><Input.TextArea rows={4} maxLength={10000} placeholder="说明如何修复、验证或确认问题已解决" /></Form.Item>
            <Space wrap><Button type="primary" htmlType="submit" loading={saving} disabled={disabled}>确认解决</Button><Button onClick={() => setResolving(null)} disabled={saving}>取消</Button></Space>
          </Form>
        </Modal>
      </>}
    </main>
  );
}
