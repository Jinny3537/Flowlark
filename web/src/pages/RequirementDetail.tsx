import RequirementWorkflow, { RequirementActions } from './RequirementWorkflow';
import RequirementPrototypeButton from './RequirementPrototypeButton';
import RequirementFields, { requirementSections } from './RequirementFields';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { safeRequirementUrl } from './requirementsModel.js';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Descriptions, Form, List, Modal, Space, Tabs, Tag } from 'antd';
import { EditOutlined, ExportOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { requirementPayload } from './requirementsModel.js';

const statusLabels: Record<string, string> = {
  not_started: '未开始',
  designing: '已归档 / 待定稿',
  finalized: '已定稿',
  delivered: '原型已确认',
};

export default function RequirementDetail() {
  const navigate = useNavigate();
  const { code = '' } = useParams();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      setItem(await api.getRequirement(code));
    } catch (nextError) {
      setError(errorText(nextError, '无法读取需求详情'));
    } finally {
      setLoading(false);
    }
  }, [code]);

  const startEdit = useCallback(() => {
    form.setFieldsValue({
      ...item,
      title: item?.title || '',
      description: item?.description || '',
      owner: item?.owner || '',
      dueDate: item?.dueDate ? dayjs(item.dueDate, 'YYYY-MM-DD') : null,
    });
    setEditOpen(true);
  }, [form, item]);

  const save = useCallback(async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await api.updateRequirement(code, requirementPayload(values));
      await load();
      message.success('需求已更新');
      setEditOpen(false);
    } catch (nextError) {
      message.error(errorText(nextError, '更新需求失败'));
    } finally {
      setSaving(false);
    }
  }, [code, form, message]);

  const exportPackage = useCallback(async () => {
    setExporting(true);
    try {
      const result: any = await api.exportRequirement(code);
      message.success(`已导出到 ${result.outputDir}`);
    } catch (nextError) {
      message.error(errorText(nextError, '导出需求包失败'));
    } finally {
      setExporting(false);
    }
  }, [code, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const renderSections = (keys: string[]) => requirementSections.filter(([key]) => keys.includes(key)).map(([key, label, placeholder]) => (
    <section className="fl-detail-section" key={key}>
      <h2>{label}</h2>
      {item?.[key] ? <div className="fl-requirement-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(String(item[key]), { async: false, gfm: true, breaks: true }) as string) }} /> : <p className="fl-muted">{placeholder}</p>}
    </section>
  ));

  return (
    <main className="fl-page fl-requirement-detail">
      <PageHeader
        eyebrow="需求详情"
        title={item?.title || code}
        description={`需求 ID：${code}`}
        backTo="/requirements"
        actions={item ? (
          <Space wrap>
            <RequirementPrototypeButton code={code} />
            <RequirementActions item={item} writable={writable} onChanged={load} />
            <Button icon={<EditOutlined />} disabled={!writable || !!item.deletedAt} onClick={startEdit}>编辑</Button>
            <Button icon={<ExportOutlined />} loading={exporting} disabled={!writable} onClick={exportPackage}>导出需求包</Button>
          </Space>
        ) : null}
      />
      <State loading={loading && item?.code !== code} error={error} onRetry={load} empty={!item} emptyText="没有找到需求">
        <div className="fl-detail-stack">
          <section className="fl-detail-summary">
<Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="需求标题">{textOf(item?.title)}</Descriptions.Item>
              <Descriptions.Item label="本地原型进度"><Tag>{statusLabels[item?.derivedStatus] || textOf(item?.derivedStatus, '未开始')}</Tag></Descriptions.Item>
              <Descriptions.Item label="负责人">{textOf(item?.owner)}</Descriptions.Item>
              <Descriptions.Item label="项目">{textOf(item?.project, '未分项目')}</Descriptions.Item>
              <Descriptions.Item label="模块">{textOf(item?.module, '未分模块')}</Descriptions.Item>
              <Descriptions.Item label="优先级">{textOf(item?.priority)}</Descriptions.Item>
              <Descriptions.Item label="需求池阶段">{textOf(item?.stage, '待明确')}</Descriptions.Item>
</Descriptions>
          </section>
          <Tabs key={code} defaultActiveKey="workflow" items={[
            { key: 'workflow', label: '协作与开发依据', children: item ? <RequirementWorkflow item={item} writable={writable} onChanged={load} /> : null },
            { key: 'local', label: '本地分析与历史', children: <div className="fl-detail-stack"><section className="fl-detail-section"><h2>本地分析（同步保留）</h2><p style={{ whiteSpace: 'pre-wrap' }}>{item?.localNotes || '尚未补充分析、待确认问题与决策理由'}</p></section><List dataSource={[...(item?.history || [])].reverse()} locale={{ emptyText: '暂无变更记录，旧数据不会补造历史' }} renderItem={(event: any) => <List.Item><div><strong>{fmtTime(event.at)} · {event.action === 'update' ? '字段更新' : event.action}</strong>{event.by ? <p>{event.by}</p> : null}{event.changes?.map((change: any) => <p key={change.field} style={{ overflowWrap: 'anywhere' }}>{change.field}：{typeof change.before === 'object' ? JSON.stringify(change.before) : String(change.before ?? '')} → {typeof change.after === 'object' ? JSON.stringify(change.after) : String(change.after ?? '')}</p>)}</div></List.Item>} /></div> },
            { key: 'content', label: '需求内容', children: <div className="fl-detail-stack">{renderSections(['businessValue', 'description'])}</div> },
            { key: 'rules', label: '规则与验收', children: <div className="fl-detail-stack"><section className="fl-detail-summary"><Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="类型">{textOf(item?.type)}</Descriptions.Item>
              <Descriptions.Item label="功能点">{textOf(item?.functionPoints, '待确认')}</Descriptions.Item>
              <Descriptions.Item label="影响范围">{textOf(item?.impactScope, '待评估')}</Descriptions.Item>
</Descriptions></section>{renderSections(['businessRule', 'acceptanceCriteria'])}</div> },
            { key: 'delivery', label: '交付计划', children: <section className="fl-detail-summary"><Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="本地截止日期">
                <Space size="small" wrap>
                  <span>{textOf(item?.dueDate)}</span>
                  {item?.overdue ? <Tag color="error">已逾期</Tag> : null}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="发布计划">{textOf(item?.versionName, item?.versionId || '未分配')}</Descriptions.Item>
              <Descriptions.Item label="期望上线">{textOf(item?.expectedOnlineDate, 'TBD')}</Descriptions.Item>
              <Descriptions.Item label="目标交付">{textOf(item?.targetDeliveryDate, 'TBD')}</Descriptions.Item>
</Descriptions></section> },
            { key: 'source', label: '来源与资料', children: <div className="fl-detail-stack"><section className="fl-detail-summary"><Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="接入来源">{item?.external ? '需求池' : '本地'}</Descriptions.Item>
              <Descriptions.Item label="需求池状态">{textOf(item?.external?.status)}</Descriptions.Item>
              <Descriptions.Item label="分析状态">{textOf(item?.analysisStatus)}</Descriptions.Item>
              <Descriptions.Item label="需求来源">{textOf(item?.source)}</Descriptions.Item>
              <Descriptions.Item label="提出日期">{textOf(item?.proposedDate)}</Descriptions.Item>
              <Descriptions.Item label="需求池最近更新">{item?.sourceUpdatedAt ? fmtTime(item.sourceUpdatedAt) : '—'}</Descriptions.Item>
              <Descriptions.Item label="最近同步">{item?.external?.syncedAt ? fmtTime(item.external.syncedAt) : '—'}</Descriptions.Item>
              <Descriptions.Item label="原型 / 资料">{safeRequirementUrl(item?.protoUrl) ? <a href={safeRequirementUrl(item.protoUrl)} target="_blank" rel="noreferrer">打开原型 / 资料</a> : textOf(item?.protoUrl, '暂无')}</Descriptions.Item>
              <Descriptions.Item label="需求原文">{safeRequirementUrl(item?.url) ? <a href={safeRequirementUrl(item.url)} target="_blank" rel="noreferrer">打开需求原文</a> : '暂无链接'}</Descriptions.Item>
</Descriptions></section>{renderSections(['rawDescription'])}</div> },
            { key: 'versions', label: `关联版本（${item?.versions?.length || 0}）`, children: (
          <section className="fl-detail-section">
            <h2>跨项目版本演进</h2>
            <List
              locale={{ emptyText: '还没有关联版本' }}
              dataSource={item?.versions || []}
              renderItem={(version: any) => {
                const versionNo = version.versionNo || version.no;
                return (
                  <List.Item extra={<Tag color={version.isBaseline ? 'success' : 'default'}>{version.isBaseline ? '当前基线' : '非基线'}</Tag>}>
                    <List.Item.Meta
                      title={(
                        <Button
                          type="link"
                          className="fl-result-link"
                          onClick={() => navigate(`/projects/${encodeURIComponent(version.project)}/versions/${encodeURIComponent(versionNo)}`)}
                        >
                          {version.project} / {versionNo} · {textOf(version.title)}
                        </Button>
                      )}
                      description={version.createdAt ? `创建于 ${fmtTime(version.createdAt)}` : '打开版本工作台'}
                    />
                  </List.Item>
                );
              }}
            />
          </section> ) },
          ]} />
        </div>
      </State>

      <Modal width={800} title="编辑需求" open={editOpen} confirmLoading={saving} onOk={save} onCancel={() => setEditOpen(false)}>
        {item?.external ? <Alert type="info" showIcon message="源字段的本地副本会在同步时更新。请将分析与待确认问题写入“本地分析”，该字段同步时保留；修改源需求请前往需求池。" style={{ marginBottom: 16 }} /> : null}
        <Form form={form} layout="vertical"><RequirementFields /></Form>
      </Modal>
    </main>
  );
}
