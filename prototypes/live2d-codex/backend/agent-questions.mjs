export function questionsView(questions = []) {
  return questions.map((q, i) => ({ id: String(i), header: q.header || '', question: q.question || q.header || '请补充信息', multiSelect: !!q.multiSelect, required: true, options: (q.options ?? []).map(o => ({ label: o.label, description: o.description || '' })) }));
}
export function questionAnswers(questions, answer, arrays = false) {
  const result = {};
  for (const [i, question] of questions.entries()) {
    const value = answer?.answers?.[String(i)];
    const values = (Array.isArray(value) ? value : [value]).map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean);
    if (!values.length || values.some(v => v.length > 8000)) throw new Error('请填写每个问题的回答。');
    result[question.question] = arrays ? values : values.join(', ');
  }
  return result;
}
export function formView(schema) {
  return Object.entries(schema.properties ?? {}).map(([id, field]) => ({
    id, header: field.title || id, question: [field.title || id, field.description].filter(Boolean).join(' · '),
    required: (schema.required ?? []).includes(id), multiSelect: field.type === 'array', fieldType: field.type,
    options: (field.oneOf ?? field.items?.oneOf ?? (field.enum ?? field.items?.enum ?? []).map(value => ({ const: value }))).map(v => ({ label: String(v.title ?? v.const), value: String(v.const) })),
  }));
}
export function formAnswer(schema, answer) {
  const content = {};
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    const raw = answer?.answers?.[key];
    if (raw === undefined || raw === '' || Array.isArray(raw) && !raw.length) {
      if (schema.required?.includes(key)) throw new Error(`请填写 ${field.title || key}。`);
      continue;
    }
    let value = raw;
    if (field.type === 'boolean') {
      if (!['true', 'false'].includes(raw)) throw new Error(`${field.title || key} 需填写 true 或 false。`);
      value = raw === 'true';
    } else if (field.type === 'number' || field.type === 'integer') {
      value = Number(raw);
      if (!Number.isFinite(value) || field.type === 'integer' && !Number.isInteger(value) || field.minimum != null && value < field.minimum || field.maximum != null && value > field.maximum) throw new Error(`${field.title || key} 数值无效。`);
    } else if (field.type === 'array') {
      value = Array.isArray(raw) ? raw : [raw];
      const allowed = field.items?.enum ?? field.items?.oneOf?.map(v => String(v.const));
      if (allowed && value.some(v => !allowed.includes(v)) || field.minItems != null && value.length < field.minItems || field.maxItems != null && value.length > field.maxItems) throw new Error(`${field.title || key} 选项无效。`);
    } else if (field.type && field.type !== 'string') throw new Error('此表单字段类型暂不支持，请停止本轮并在原生 CLI 中处理。');
    const allowed = field.enum ?? field.oneOf?.map(v => v.const);
    if (allowed && !allowed.some(v => v === value)) throw new Error(`请为 ${field.title || key} 选择提供的选项。`);
    if (typeof value === 'string' && (value.length > (field.maxLength ?? 8000) || value.length < (field.minLength ?? 0))) throw new Error(`${field.title || key} 长度无效。`);
    content[key] = value;
  }
  return { action: 'accept', content };
}
