import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="fl-not-found">
      <Result
        status="404"
        title="页面不存在"
        subTitle="当前路径没有匹配的 Flowlark 工作台页面。"
        extra={<Button type="primary" onClick={() => navigate('/actions')}>返回工作台</Button>}
      />
    </main>
  );
}
