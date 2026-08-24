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

export function PageHeader({ title, description, eyebrow, backTo, actions }: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="fl-page-head">
      <div className="fl-page-heading">
        {backTo ? (
          <Button
            className="fl-back-button"
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(backTo)}
          >
            返回
          </Button>
        ) : null}
        {eyebrow ? <span className="fl-page-eyebrow">{eyebrow}</span> : null}
        <h1 className="fl-page-title">{title}</h1>
        {description ? <p className="fl-page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="fl-page-actions">{actions}</div> : null}
    </header>
  );
}
