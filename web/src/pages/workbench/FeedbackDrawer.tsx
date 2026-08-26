import { CameraOutlined, CheckCircleOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Space,
  Tag,
  Typography,
  type FormProps,
} from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '@/services/api';
import type { Anchor } from './AnnotationOverlay';

export type FeedbackContext = {
  project: string;
  version: string;
  baseline: string | null;
  requirements: string[];
  changes: Array<Record<string, unknown>>;
  anchor: Anchor;
  url: string;
};

type FeedbackDrawerProps = {
  open: boolean;
  context: FeedbackContext;
  captureRect: DOMRect | null;
  onClose: () => void;
  onSubmitted: () => Promise<void> | void;
};

type FeedbackFields = {
  title: string;
  description: string;
};

const alertStyle: CSSProperties = {
  marginBottom: 'var(--fl-s-4)',
};

const captureRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 'var(--fl-s-2)',
};

const contextStyle: CSSProperties = {
  marginTop: 'var(--fl-s-2)',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 'var(--fl-s-2)',
};

function errorMessage(error: unknown) {
  return error instanceof Error && error.message && error.message !== 'NETWORK'
    ? error.message
    : '反馈保存失败，请稍后重试';
}

export function FeedbackDrawer({
  open,
  context,
  captureRect,
  onClose,
  onSubmitted,
}: FeedbackDrawerProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FeedbackFields>();
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [screenshotBase64, setScreenshotBase64] = useState('');

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setScreenshotBase64('');
  }, [form, open]);

  async function captureScreenshot() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      message.info('未截取截图，仍可继续提交反馈');
      return;
    }

    setCapturing(true);
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: false,
      });

      const rect = captureRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('NO_CAPTURE_RECT');

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      if (!video.videoWidth || !video.videoHeight) throw new Error('EMPTY_CAPTURE');

      const scaleX = video.videoWidth / Math.max(window.innerWidth, 1);
      const scaleY = video.videoHeight / Math.max(window.innerHeight, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(rect.width * scaleX));
      canvas.height = Math.max(1, Math.round(rect.height * scaleY));

      const drawingContext = canvas.getContext('2d');
      if (!drawingContext) throw new Error('NO_CANVAS_CONTEXT');

      drawingContext.drawImage(
        video,
        rect.left * scaleX,
        rect.top * scaleY,
        rect.width * scaleX,
        rect.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const dataUrl = canvas.toDataURL('image/png');
      setScreenshotBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
    } catch {
      message.info('未截取截图，仍可继续提交反馈');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setCapturing(false);
    }
  }

  async function submitFeedback(values: FeedbackFields) {
    setSaving(true);
    try {
      await api.createFeedbackDraft({
        ...context,
        title: values.title.trim(),
        description: values.description.trim(),
        screenshotBase64: screenshotBase64 || undefined,
      });

      message.success('反馈已保存');
      try {
        await onSubmitted();
      } catch {
        message.warning('反馈已保存，但反馈列表刷新失败');
      }
      onClose();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const handleFinish: FormProps<FeedbackFields>['onFinish'] = (values) => {
    void submitFeedback(values);
  };

  function handleClose() {
    if (!saving && !capturing) onClose();
  }

  return (
    <Drawer
      open={open}
      title="记录原型反馈"
      placement="right"
      width="min(460px, 100vw)"
      destroyOnHidden
      closable={!saving && !capturing}
      keyboard={!saving && !capturing}
      maskClosable={!saving && !capturing}
      onClose={handleClose}
      footer={(
        <div style={footerStyle}>
          <Button disabled={saving || capturing} onClick={handleClose}>
            取消
          </Button>
          <Button
            type="primary"
            loading={saving}
            disabled={capturing}
            onClick={() => form.submit()}
          >
            保存反馈
          </Button>
        </div>
      )}
    >
      <Alert
        showIcon
        type="info"
        style={alertStyle}
        message="反馈会保存到当前版本上下文，提交后可在标注反馈中继续处理。"
      />

      <Form<FeedbackFields>
        form={form}
        layout="vertical"
        requiredMark="optional"
        autoComplete="off"
        initialValues={{ title: '', description: '' }}
        onFinish={handleFinish}
      >
        <Form.Item
          name="title"
          label="反馈标题"
          required
          rules={[{ required: true, whitespace: true, message: '请填写反馈标题' }]}
        >
          <Input maxLength={200} showCount placeholder="一句话说明问题" />
        </Form.Item>

        <Form.Item
          name="description"
          label="问题描述"
          required
          rules={[{ required: true, whitespace: true, message: '请填写问题描述' }]}
        >
          <Input.TextArea
            rows={6}
            maxLength={5000}
            showCount
            placeholder="说明预期、现象和复现方式"
          />
        </Form.Item>

        <Form.Item label="区域截图">
          <div style={captureRowStyle}>
            <Button
              icon={<CameraOutlined />}
              loading={capturing}
              disabled={saving}
              onClick={() => void captureScreenshot()}
            >
              授权截取当前标签页
            </Button>
            {screenshotBase64 ? (
              <Tag color="success" icon={<CheckCircleOutlined />}>
                已截取
              </Tag>
            ) : (
              <Typography.Text type="secondary">
                可选；拒绝授权不影响提交
              </Typography.Text>
            )}
          </div>
        </Form.Item>
      </Form>

      <Descriptions size="small" column={1} bordered style={contextStyle}>
        <Descriptions.Item label="项目">{context.project}</Descriptions.Item>
        <Descriptions.Item label="版本">{context.version}</Descriptions.Item>
        <Descriptions.Item label="基线">{context.baseline || '未设置'}</Descriptions.Item>
        <Descriptions.Item label="需求">
          {context.requirements.length ? (
            <Space size={[4, 4]} wrap>
              {context.requirements.map((requirement) => (
                <Tag key={requirement}>{requirement}</Tag>
              ))}
            </Space>
          ) : '无'}
        </Descriptions.Item>
      </Descriptions>
    </Drawer>
  );
}
