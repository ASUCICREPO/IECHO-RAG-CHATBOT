FROM public.ecr.aws/shelf/lambda-libreoffice-base:7.6-node18-x86_64

COPY package*.json ${LAMBDA_TASK_ROOT}/
RUN npm install --production

COPY index.js ${LAMBDA_TASK_ROOT}/

CMD ["index.handler"]