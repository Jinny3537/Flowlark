import { useParams } from 'react-router-dom';

export { useParams };

export const history = {
  push(path: string) {
    window.location.hash = path.startsWith('/') ? path : `/${path}`;
  },
};
