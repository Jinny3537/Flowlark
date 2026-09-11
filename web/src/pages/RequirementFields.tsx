import { Col, Collapse, DatePicker, Form, Input, Row, Select } from 'antd';

export const requirementSections = [
  ['businessValue', '需求背景 / 目的', '需求背景 / 业务价值待确认'],
  ['description', '需求描述', '业务需求描述待确认'],
  ['rawDescription', '原始需求', '未提供'],
  ['businessRule', '业务规则 / 逻辑细节', '业务规则 / 逻辑细节待确认'],
  ['acceptanceCriteria', '验收标准', '验收标准待确认'],
];

export default function RequirementFields({ creating = false }: { creating?: boolean }) {
  return <>
    {creating ? <Form.Item name="code" label="需求 ID" rules={[{ required: true, message: '请填写需求 ID' }]}><Input placeholder="REQ-0275" /></Form.Item> : null}
    <Form.Item name="title" label="需求标题" rules={[{ required: true, message: '请填写需求标题' }]}><Input /></Form.Item>
    <Collapse defaultActiveKey={['basic', 'content']} items={[
      { key: 'basic', label: '基本信息', forceRender: true, children: <Row gutter={16}>
        {renderInputs([['project', '所属项目'], ['module', '所属模块'], ['owner', '负责人']])}
        <Col xs={24} sm={12}><Form.Item name="type" label="需求类型"><Input placeholder="新功能 / 功能优化 / 缺陷修复" /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item name="priority" label="交付优先级"><Select allowClear options={['P0', 'P1', 'P2', 'P3'].map(value => ({ value, label: value }))} /></Form.Item></Col>
      </Row> },
      { key: 'content', label: '需求内容', forceRender: true, children: requirementSections.filter(([key]) => key === 'businessValue' || key === 'description').map(renderContent) },
      { key: 'local', label: '本地分析与待确认项（同步保留）', forceRender: true, children: <Form.Item name="localNotes" label="本地补充"><Input.TextArea rows={5} placeholder="记录分析、待确认问题及决策理由；独立于外部需求原文保存" /></Form.Item> },
      { key: 'rules', label: '范围、规则与验收', forceRender: true, children: <>
        <Row gutter={16}>{renderInputs([['functionPoints', '功能点'], ['impactScope', '影响范围']])}</Row>
        {requirementSections.filter(([key]) => key === 'businessRule' || key === 'acceptanceCriteria').map(renderContent)}
      </> },
      { key: 'delivery', label: '交付计划', forceRender: true, children: <Row gutter={16}>
        {renderInputs([['versionName', '发布计划'], ['expectedOnlineDate', '期望上线'], ['targetDeliveryDate', '目标交付']])}
        <Col xs={24} sm={12}><Form.Item name="dueDate" label="本地截止日期" extra="独立于需求池的期望上线与目标交付时间"><DatePicker className="fl-full-width" format="YYYY-MM-DD" /></Form.Item></Col>
      </Row> },
      { key: 'source', label: '来源与补充资料', forceRender: true, children: <>
        <Row gutter={16}>{renderInputs([['source', '需求来源'], ['stage', '需求池阶段'], ['analysisStatus', '分析状态'], ['proposedDate', '提出日期'], ['protoUrl', '原型 / 资料链接'], ['url', '需求原文链接']])}</Row>
        {requirementSections.filter(([key]) => key === 'rawDescription').map(renderContent)}
      </> },
    ]} />
  </>;
}

function renderInputs(fields: string[][]) {
  return fields.map(([key, label]) => <Col xs={24} sm={12} key={key}><Form.Item name={key} label={label}><Input /></Form.Item></Col>);
}

function renderContent([key, label, placeholder]: string[]) {
  return <Form.Item key={key} name={key} label={label}><Input.TextArea rows={3} placeholder={placeholder} /></Form.Item>;
}
