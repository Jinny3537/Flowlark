import { Alert, App, Button, Checkbox, Form, Input, Space } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';

export function ProjectAcceptanceRules({ slug, value, writable, onSaved }: {
  slug: string; value: any; writable: boolean; onSaved: (project: any) => void;
}) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (value) form.setFieldsValue(value); }, [form, value]);
  async function save() {
    let fields;
    try { fields = await form.validateFields(); } catch { return; }
    if (!writable) return;
    setSaving(true);
    setError('');
    try {
      const project = await api.updateProject(slug, { acceptance: { roles: fields.roles, rule: { type: 'all-required' } } });
      onSaved(project);
      message.success('验收规则已保存，下次正式交付时生效');
    } catch (error) { setError(errorText(error, '验收规则保存失败')); }
    finally { setSaving(false); }
  }
  return <section className="fl-settings-section" aria-labelledby="acceptance-rules-title" style={{ marginTop: 24, minWidth: 0 }}>
    <div className="fl-section-head"><div><h2 id="acceptance-rules-title">验收规则</h2><p>全部必选角色通过且阻断反馈清零后，交付才通过验收。历史快照保留创建时的规则。</p></div></div>
    {!writable ? <Alert type="info" message="当前只读，可查看验收规则。" /> : null}
    {error ? <Alert type="error" showIcon message={error} /> : null}
    <Form form={form} layout="vertical" disabled={!writable}>
      <Form.List name="roles">{(fields, { add, remove }) => <>
        {fields.map((field) => <div key={field.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--fl-line)', paddingTop: 12 }}>
          <Form.Item name={[field.name, 'id']} label="角色标识" style={{ flex: '1 1 160px' }} rules={[{ required: true, pattern: /^[a-z0-9_-]{1,40}$/, message: '使用 1–40 位小写字母、数字、下划线或连字符' }]}><Input /></Form.Item>
          <Form.Item name={[field.name, 'name']} label="角色名称" style={{ flex: '1 1 160px' }} rules={[{ required: true, whitespace: true, max: 80, message: '请填写角色名称' }]}><Input /></Form.Item>
          <Form.Item name={[field.name, 'required']} valuePropName="checked"><Checkbox>必选角色</Checkbox></Form.Item>
          <Button danger disabled={!writable || fields.length <= 1} onClick={() => remove(field.name)} style={{ minHeight: 44 }}>移除角色</Button>
        </div>)}
        <Space wrap style={{ marginTop: 16 }}>
          <Button disabled={!writable || fields.length >= 20} onClick={() => add({ id: '', name: '', required: true })} style={{ minHeight: 44 }}>添加验收角色</Button>
          <Button type="primary" disabled={!writable} loading={saving} onClick={() => void save()} style={{ minHeight: 44 }}>保存验收规则</Button>
        </Space>
      </>}</Form.List>
    </Form>
  </section>;
}
