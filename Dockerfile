# Use the official Node.js image as the base image  
FROM node:20
  
# Set the working directory in the container  
WORKDIR /app  
  
# Copy the application source code to the container  
COPY . .  
  
# Install the dependencies  
RUN npm install
  
# Expose the port the app will run on  
EXPOSE 3978  
  
# Start the application  
CMD ["npm", "start"]  
