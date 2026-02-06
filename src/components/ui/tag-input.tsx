import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface TagInputProps {
  tags: string[];
  onAdd: (value: string) => void | Promise<void>;
  onRemove: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  addLabel?: string;
  tagListMaxHeight?: string;
}

export function TagInput({
  tags,
  onAdd,
  onRemove,
  placeholder,
  helperText,
  addLabel = 'Add',
  tagListMaxHeight = '9rem',
}: TagInputProps) {
  const [value, setValue] = useState('');

  const tryAdd = async () => {
    const raw = value.trim();
    if (!raw) return;
    await onAdd(raw);
    setValue('');
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              void tryAdd();
            }
          }}
          placeholder={placeholder}
        />
        <Button onClick={() => void tryAdd()} variant="secondary">
          {addLabel}
        </Button>
      </div>
      {helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
      {tags.length > 0 && (
        <div
          className="flex flex-wrap gap-2 mt-2 overflow-y-auto pr-1"
          style={{ maxHeight: tagListMaxHeight }}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-destructive/10 text-destructive rounded-md"
            >
              {tag}
              <button
                onClick={() => onRemove(tag)}
                className="hover:text-destructive/80"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
