FROM python:3.12-slim

# 设置工作目录
WORKDIR /app

# 复制依赖配置并安装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制项目代码
COPY . .

# 暴露默认端口（FastAPI/Docker通用）
EXPOSE 8000

# 启动服务。兼容 Hugging Face 默认的 7860 端口与常规云平台的 $PORT 环境变量
CMD ["sh", "-c", "python -m uvicorn backend.server:app --host 0.0.0.0 --port ${PORT:-7860}"]
