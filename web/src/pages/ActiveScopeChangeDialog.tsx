import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Space, Steps, Table, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { milestoneItems } from './milestoneModel.js';

type Props = {
  open: boolean;
  name: string;
  item: any;
  requirements: any[];
  projects: any[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

export function ActiveScopeChangeDialog({ open, name, item, requirements, projects, onClose, onChanged }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const selectedProject = Form.useWatch('project', form);
  const [draft, setDraft] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(milestoneItems(item?.items || []));
    setVersions([]);
    setReason('');
    setImpactConfirmed(false);
    setPlan(null);
    setResolutions({});
    setError('');
    form.resetFields();
  }, [form, item?.items, open]);

  const changed = useMemo(() => JSON.stringify(milestoneItems(item?.items || [])) !== JSON.stringify(draft), [draft, item?.items]);

  async function loadVersions(project: string) {
    form.setFieldValue('version', undefined);
    setVersions([]);
    if (!project) return;
    setVersionsLoading(true);
    try {
      setVersions(await api.listVersions(project, { includeDraft: true, includeVoid: false }));
    } catch (nextError) {
      message.error(errorText(nextError, '无法读取项目版本'));
    } finally {
      setVersionsLoading(false);
    }
  }

  async function addCandidate() {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const key = `${values.requirement}:${values.project}:${values.version}`;
    if (draft.some((entry) => `${entry.requirement}:${entry.project}:${entry.version}` === key)) {
      message.info('该需求版本已在候选范围中');
      return;
    }
    setDraft((current) => [...current, values]);
    form.resetFields();
    setVersions([]);
  }

  async function next() {
    if (!plan) {
      if (!changed || !reason.trim()) return;
      setBusy(true);
      setError('');
      try {
        const nextPlan = await api.planMilestoneSync(name, { scopeItems: draft, reason: reason.trim(), resolutions });
        setPlan(nextPlan);
        if (nextPlan.blockers?.length) setError(`仍有 ${nextPlan.blockers.length} 个阻塞项，不能执行`);
      } catch (nextError) {
        setError(errorText(nextError, '生成范围变更计划失败'));
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api.executeMilestoneSync(name, {
        planHash: plan.hash,
        scopeItems: draft,
        confirmed: true,
        reason: reason.trim(),
        confirmUnfinished: impactConfirmed,
        resolutions,
      });
      message.success('进行中迭代范围已更新并完成平台验证');
      onClose();
      await onChanged();
    } catch (nextError) {
      setError(errorText(nextError, '范围变更执行失败'));
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(operation: any, resolution: 'restore-local' | 'accept-remote') {
    const key = String(operation.key || '').replace(/:conflict$/, '');
    const nextResolutions = { ...resolutions, [key]: resolution };
    setBusy(true);
    setError('');
    try {
      const nextPlan = await api.planMilestoneSync(name, {
        scopeItems: draft,
        reason: reason.trim(),
        resolutions: nextResolutions,
      });
      setResolutions(nextResolutions);
      setPlan(nextPlan);
    } catch (nextError) {
      setError(errorText(nextError, '冲突处理失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      width={920}
      title="变更进行中迭代范围"
      open={open}
      okText={plan ? '确认并执行' : '生成变更计划'}
      confirmLoading={busy}
      okButtonProps={{
        danger: Boolean(plan),
        disabled: plan
          ? Boolean(plan.blockers?.length) || !impactConfirmed
          : !changed || !reason.trim(),
      }}
      onOk={() => void next()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Steps
        size="small"
        current={plan ? 1 : 0}
        items={[{ title: '编辑候选范围' }, { title: '审阅同步计划' }, { title: '执行并验证' }]}
      />
      {!plan ? (
        <>
          <Alert className="fl-mcp-result" type="warning" showIcon message="这是高风险范围变更" description="当前迭代保持进行中；只有远端操作全部执行并回读验证成功后，候选范围才会写入 Flowlark。" />
          <Table
            rowKey={(entry: any) => `${entry.requirement}:${entry.project}:${entry.version}`}
            size="small"
            pagination={false}
            dataSource={draft}
            columns={[
              { title: '需求', dataIndex: 'requirement' },
              { title: '项目', dataIndex: 'project' },
              { title: '版本', dataIndex: 'version' },
              {
                title: '操作', width: 90,
                render: (_, entry: any) => (
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setDraft((current) => current.filter((item) => item !== entry))}>移除</Button>
                ),
              },
            ]}
            scroll={{ x: 620, y: 220 }}
          />
          <Form form={form} layout="vertical" className="fl-mcp-result">
            <div className="fl-mcp-form-grid">
              <Form.Item name="requirement" label="需求" rules={[{ required: true, message: '请选择需求' }]}>
                <Select showSearch optionFilterProp="label" options={requirements.map((requirement) => ({ value: requirement.code, label: `${requirement.code} · ${requirement.title}` }))} />
              </Form.Item>
              <Form.Item name="project" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
                <Select showSearch optionFilterProp="label" options={projects.map((project) => ({ value: project.slug, label: project.name || project.slug }))} onChange={loadVersions} />
              </Form.Item>
            </div>
            <Space align="end" wrap>
              <Form.Item name="version" label="版本" rules={[{ required: true, message: '请选择版本' }]}>
                <Select style={{ minWidth: 280 }} showSearch optionFilterProp="label" disabled={!selectedProject} loading={versionsLoading} options={versions.map((version) => ({ value: version.versionNo, label: `${version.versionNo} · ${version.title}` }))} />
              </Form.Item>
              <Form.Item label=" "><Button icon={<PlusOutlined />} onClick={() => void addCandidate()}>加入候选范围</Button></Form.Item>
            </Space>
          </Form>
          <label htmlFor="active-scope-change-reason">变更原因</label>
          <Input.TextArea id="active-scope-change-reason" value={reason} rows={3} maxLength={255} showCount onChange={(event) => setReason(event.target.value)} />
        </>
      ) : (
        <>
          <Space wrap className="fl-mcp-result">
            <Tag>创建 {plan.summary?.createTask || 0}</Tag>
            <Tag>更新 {plan.summary?.updateTask || 0}</Tag>
            <Tag>迁移 {plan.summary?.moveTask || 0}</Tag>
            <Tag color={plan.blockers?.length ? 'error' : 'success'}>阻塞 {plan.blockers?.length || 0}</Tag>
          </Space>
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={plan.operations || []}
            columns={[
              { title: '操作', dataIndex: 'kind', render: (value) => <code>{value}</code> },
              { title: '对象', render: (_, operation: any) => operation.requirement || operation.taskId || name },
              { title: '风险', dataIndex: 'risk', render: (value) => <Tag color={value === 'high' ? 'error' : 'default'}>{value === 'high' ? '高风险' : '普通'}</Tag> },
              {
                title: '处理', width: 190,
                render: (_, operation: any) => operation.kind === 'conflict' ? (
                  <Space size={4}>
                    <Button size="small" onClick={() => void resolveConflict(operation, 'restore-local')}>保留 Flowlark</Button>
                    <Button size="small" onClick={() => void resolveConflict(operation, 'accept-remote')}>接受平台值</Button>
                  </Space>
                ) : null,
              },
            ]}
            scroll={{ x: 620, y: 260 }}
          />
          <Alert className="fl-mcp-result" type="info" showIcon message={`变更原因：${reason}`} description={`计划哈希：${plan.hash}`} />
          <Checkbox checked={impactConfirmed} onChange={(event) => setImpactConfirmed(event.target.checked)}>我已审阅任务迁入、迁出和未完成任务影响</Checkbox>
          <Button className="fl-mcp-result" onClick={() => { setPlan(null); setResolutions({}); setImpactConfirmed(false); }}>返回修改候选范围</Button>
        </>
      )}
      {error ? <Alert className="fl-mcp-result" type="error" showIcon message={error} /> : null}
    </Modal>
  );
}
