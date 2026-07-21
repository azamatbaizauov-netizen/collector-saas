import { describe, it, expect } from 'vitest';
import { isNoiseMessage } from './noise-filter.js';

describe('isNoiseMessage', () => {
  it('шум: пустое / пробелы', () => {
    expect(isNoiseMessage('')).toBe(true);
    expect(isNoiseMessage('   ')).toBe(true);
  });

  it('шум: голые подтверждения и приветствия', () => {
    for (const t of ['ок', 'Окей', 'спасибо', 'спс', 'да', 'хорошо', 'принято', 'договорились', 'привет', 'добрый день']) {
      expect(isNoiseMessage(t)).toBe(true);
    }
  });

  it('шум: только эмодзи/пунктуация', () => {
    expect(isNoiseMessage('👍')).toBe(true);
    expect(isNoiseMessage('!!!')).toBe(true);
    expect(isNoiseMessage('👍👍🙏')).toBe(true);
  });

  it('НЕ шум: есть цифра (срок/сумма/остаток)', () => {
    expect(isNoiseMessage('оплачу 15')).toBe(false);
    expect(isNoiseMessage('остаток 300')).toBe(false);
    expect(isNoiseMessage('25.07')).toBe(false);
  });

  it('НЕ шум: смысловые ответы без цифр', () => {
    expect(isNoiseMessage('оплатил')).toBe(false);
    expect(isNoiseMessage('оплачу завтра')).toBe(false);
    expect(isNoiseMessage('переведу на следующей неделе')).toBe(false);
    expect(isNoiseMessage('спасибо большое, оплачу')).toBe(false);
  });

  it('НЕ шум: фраза длиннее лимита слов, даже из ack-слов', () => {
    expect(isNoiseMessage('да да да да')).toBe(false);
  });
});
