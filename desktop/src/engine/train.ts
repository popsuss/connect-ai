// 🚀 장기 기억 학습 — 사용자 데이터셋으로 미리 채운 Unsloth 파인튜닝 Colab 노트북(.ipynb) 생성.
//   GitHub에 커밋 → Colab(무료 GPU)에서 원클릭 실행 → GGUF 모델 → LM Studio/Ollama 로드.

const md = (lines: string[]) => ({ cell_type: 'markdown', metadata: {}, source: lines });
const code = (lines: string[]) => ({ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: lines });

export function buildNotebook(datasetRepo: string, baseModel: string, outModelRepo: string): string {
  const base = baseModel || 'unsloth/gemma-2-2b-it-bnb-4bit';
  const nb = {
    nbformat: 4, nbformat_minor: 0,
    metadata: { accelerator: 'GPU', colab: { provenance: [], gpuType: 'T4' }, kernelspec: { name: 'python3', display_name: 'Python 3' }, language_info: { name: 'python' } },
    cells: [
      md([
        '# 🧬 Connect AI — 장기 기억 학습 (Unsloth)\n',
        '내 1인 기업 지식을 모델에 **체득**시킵니다. 위 메뉴 **런타임 → 모두 실행**만 누르면 됩니다 (무료 T4 GPU).\n',
        '- 데이터셋: `' + datasetRepo + '`\n',
        '- 베이스 모델: `' + base + '`\n',
        '- 결과 모델: `' + outModelRepo + '` (GGUF — LM Studio/Ollama에 바로 로드)\n',
      ]),
      code(['%%capture\n', '!pip install unsloth\n', '!pip install --no-deps "xformers<0.0.27" trl peft accelerate bitsandbytes datasets\n']),
      code([
        'from unsloth import FastLanguageModel\n', 'import torch\n',
        'max_seq_length = 2048\n',
        'model, tokenizer = FastLanguageModel.from_pretrained(\n',
        '    model_name = "' + base + '",\n',
        '    max_seq_length = max_seq_length, load_in_4bit = True,\n', ')\n',
        'model = FastLanguageModel.get_peft_model(\n',
        '    model, r = 16, lora_alpha = 16, lora_dropout = 0,\n',
        '    target_modules = ["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],\n',
        '    use_gradient_checkpointing = "unsloth", random_state = 3407,\n', ')\n',
      ]),
      code([
        'from datasets import load_dataset\n',
        '# Connect AI 앱이 업로드한 지식 데이터셋\n',
        'ds = load_dataset("' + datasetRepo + '", data_files="connect-ai-knowledge.jsonl", split="train")\n',
        'def fmt(ex):\n',
        '    return { "text": tokenizer.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False) }\n',
        'ds = ds.map(fmt)\n', 'print(ds[0]["text"][:500])\n',
      ]),
      code([
        'from trl import SFTTrainer\n', 'from transformers import TrainingArguments\n',
        'trainer = SFTTrainer(\n',
        '    model = model, tokenizer = tokenizer, train_dataset = ds,\n',
        '    dataset_text_field = "text", max_seq_length = max_seq_length,\n',
        '    args = TrainingArguments(\n',
        '        per_device_train_batch_size = 2, gradient_accumulation_steps = 4,\n',
        '        warmup_steps = 5, max_steps = 60, learning_rate = 2e-4,\n',
        '        fp16 = not torch.cuda.is_bf16_supported(), bf16 = torch.cuda.is_bf16_supported(),\n',
        '        logging_steps = 1, optim = "adamw_8bit", weight_decay = 0.01,\n',
        '        lr_scheduler_type = "linear", seed = 3407, output_dir = "outputs",\n',
        '    ),\n', ')\n', 'trainer.train()\n',
      ]),
      md(['## 💾 GGUF로 저장 (LM Studio/Ollama용)\n', '아래 셀 실행 후 나오는 토큰 입력칸에 HuggingFace **write 토큰**을 붙여넣으세요.\n']),
      code([
        'from huggingface_hub import notebook_login\n', 'notebook_login()\n',
      ]),
      code([
        '# 내 모델 = 장기 기억. q4_k_m GGUF 로 저장 + HF 업로드\n',
        'model.push_to_hub_gguf("' + outModelRepo + '", tokenizer, quantization_method = "q4_k_m")\n',
        'print("✅ 완료! huggingface.co/' + outModelRepo + ' 에서 .gguf 다운로드 → LM Studio/Ollama 로드")\n',
      ]),
    ],
  };
  return JSON.stringify(nb, null, 1);
}
