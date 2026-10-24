import { IconBolt, IconCloud, IconCube, IconDatabase, IconGlobe, IconWarning } from '../shared/icons';
import type { Category } from '../types/view';

export function CategoryIcon({ category, size = 20 }: { category: Category; size?: number }) {
  switch (category) {
    case 'frontend':
      return <IconGlobe />;
    case 'api':
      return <IconBolt />;
    case 'data':
      return <IconDatabase />;
    case 'external':
      return <IconCloud />;
    case 'unknown':
      return <IconWarning />;
    default:
      return <IconCube size={size} />;
  }
}
