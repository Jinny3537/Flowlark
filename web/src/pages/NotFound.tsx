import { history } from '@umijs/max';
import { Button, Result } from 'antd';

export default function NotFound() {
  return (
    <main className="fl-not-found">
      <Result
        status="404"
        title="页面不存在"
        subTitle="当前路径没有匹配的 Flowlark 工作台页面。"
        extra={<Button type="primary" onClick={() => history.push('/actions')}>返回个人工作台</Button>}
      />
    </main>
  );
}
