import type { ReactNode } from 'react';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';

type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  backTo?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, backTo, actions }: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <>
      <h1 className="fl-visually-hidden">{title}</h1>
      {backTo || actions ? (
        <header className="fl-page-toolbar">
          {backTo ? (
            <div className="fl-page-toolbar-context">
              <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(backTo)}>返回</Button>
              {description ? <span className="fl-muted">{description}</span> : null}
            </div>
          ) : null}
          {actions ? <div className="fl-page-actions">{actions}</div> : null}
        </header>
      ) : null}
    </>
  );
}
