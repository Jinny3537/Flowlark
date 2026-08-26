import type { ReactNode } from 'react';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  value: number;
  hint: string;
  to?: string;
};

export function MetricCard({ icon, label, value, hint, to }: MetricCardProps) {
  const navigate = useNavigate();
  const content = (
    <>
      <span className="fl-metric-icon" aria-hidden="true">{icon}</span>
      <span className="fl-metric-label">{label}</span>
      <strong className="fl-metric-value">{value}</strong>
      <span className="fl-metric-hint">{hint}</span>
      {to ? <ArrowRightOutlined className="fl-metric-arrow" aria-hidden="true" /> : null}
    </>
  );

  if (to) {
    return (
      <button className="fl-metric-card is-clickable" type="button" onClick={() => navigate(to)}>
        {content}
      </button>
    );
  }

  return <article className="fl-metric-card">{content}</article>;
}
