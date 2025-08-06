FROM public.ecr.aws/shelf/lambda-libreoffice-base:7.6-node18-x86_64

# Set HOME environment variable as required
ENV HOME=/tmp

# Copy function code
COPY index.js ${LAMBDA_TASK_ROOT}/
COPY package.json ${LAMBDA_TASK_ROOT}/

# Install dependencies
RUN npm install

# Set the CMD to your handler
CMD ["index.handler"]