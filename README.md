# Tesserak | EKS Cluster Manager

**Tesserak** is a multi-dimensional control plane for managing Kubernetes and cloud infrastructure. Starting with AWS EKS cluster provisioning, health monitoring, AWS credential connectors, and local-to-cloud state synchronization, it is built to scale cleanly toward multi-cloud, Terraform, CI/CD, and broader cloud infrastructure workflows.

## Features

- Create new EKS clusters with customizable settings
- View and monitor existing clusters and their status
- Delete clusters with proper state management
- Modern UI with Material Design
- Multi-region support
- AWS resource discovery (VPCs, Availability Zones)
- Connection management for AWS credentials
- State synchronization between local and AWS

## Tech Stack

### Backend
- Python FastAPI for API development
- Boto3 for AWS service integration
- Pydantic for data validation
- Uvicorn ASGI server
- State management system for cluster tracking

### Frontend
- React with TypeScript for type-safe development
- Material-UI components for modern UI
- Axios for API communication
- React Router for navigation
- Context API for state management

## Prerequisites

### Common Requirements (All Operating Systems)

1. **AWS Account & Credentials**
   - Active AWS Account
   - AWS Access Key and Secret Key with EKS permissions
   - Configured IAM Role for EKS cluster creation

2. **Git**
   - Windows: Download and install from [Git for Windows](https://gitforwindows.org/)
   - macOS: Install via Homebrew: `brew install git`
   - Ubuntu: `sudo apt-get update && sudo apt-get install git`

3. **Node.js & npm**
   - Download and install Node.js (v14 or higher) from [official website](https://nodejs.org/)
   - npm comes bundled with Node.js
   - Ubuntu Alternative: Use NodeSource repository:
     ```bash
     curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
     sudo apt-get install -y nodejs
     ```

4. **Python**
   - Python 3.9 or higher required
   - Windows: Download from [Python.org](https://www.python.org/downloads/windows/)
   - macOS: Install via Homebrew: `brew install python@3.11`
   - Ubuntu: 
     ```bash
     sudo apt-get update
     sudo apt-get install python3.11 python3.11-venv python3-pip
     ```

### Windows-specific Requirements

1. **Windows Terminal** (Recommended)
   - Install from Microsoft Store or [GitHub Releases](https://github.com/microsoft/terminal/releases)

2. **Visual Studio Build Tools** (If needed for Python packages)
   - Download and install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Select "Desktop development with C++" workload

### macOS-specific Requirements

1. **Xcode Command Line Tools**
   ```bash
   xcode-select --install
   ```

2. **Homebrew**
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

### Ubuntu-specific Requirements

1. **System Dependencies**
   ```bash
   sudo apt-get update
   sudo apt-get install -y \
       build-essential \
       libssl-dev \
       libffi-dev \
       python3-dev
   ```

2. **Python Virtual Environment Support**
   ```bash
   sudo apt-get install -y python3.11-venv
   ```

## Installation & Setup

### Backend Setup

#### Windows
1. Clone the repository
   ```cmd
   git clone <repository-url>
   cd technoworld
   ```

2. Create and activate virtual environment
   ```cmd
   python -m venv .venv
   .venv\Scripts\activate
   ```

3. Install dependencies
   ```cmd
   cd backend
   pip install -r requirements.txt
   ```

#### macOS
1. Clone the repository
   ```bash
   git clone <repository-url>
   cd technoworld
   ```

2. Create and activate virtual environment
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install dependencies
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

#### Ubuntu/Linux
1. Clone the repository
   ```bash
   git clone <repository-url>
   cd technoworld
   ```

2. Create and activate virtual environment
   ```bash
   python3.11 -m venv .venv
   source .venv/bin/activate
   ```

3. Install dependencies
   ```bash
   cd backend
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

### Frontend Setup

The frontend setup is identical for both Windows and macOS:

1. Navigate to frontend directory
   ```bash
   cd frontend
   ```

2. Install dependencies
   ```bash
   npm install
   ```

## Configuration

1. **Backend Environment Variables**
   Create a `.env` file in the `backend` directory:
   ```env
   EKS_CLUSTER_ROLE_ARN=arn:aws:iam::<your-account-id>:role/<your-eks-role>
   SUBNET_IDS=subnet-xxx,subnet-yyy,subnet-zzz
   ```

2. **AWS Credentials**
   You'll need to add your AWS credentials through the application's UI in the Connectors section.

## Running the Application

### Windows

1. Start Backend (in one terminal)
   ```cmd
   cd technoworld
   .venv\Scripts\activate
   cd backend
   uvicorn main:app --reload
   ```

2. Start Frontend (in another terminal)
   ```cmd
   cd technoworld/frontend
   npm start
   ```

### macOS

1. Start Backend (in one terminal)
   ```bash
   cd technoworld
   source .venv/bin/activate
   cd backend
   uvicorn main:app --reload
   ```

2. Start Frontend (in another terminal)
   ```bash
   cd technoworld/frontend
   npm start
   ```

### Ubuntu/Linux

1. Start Backend (in one terminal)
   ```bash
   cd technoworld
   source .venv/bin/activate
   cd backend
   uvicorn main:app --reload
   ```

2. Start Frontend (in another terminal)
   ```bash
   cd technoworld/frontend
   npm start
   ```

Note for Linux users: If you encounter permission issues:
```bash
# Fix npm global permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
# Add the above PATH line to your ~/.profile or ~/.bashrc

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   - Windows: 
     ```cmd
     netstat -ano | findstr 8000
     taskkill /PID <PID> /F
     ```
   - macOS/Linux:
     ```bash
     lsof -i :8000
     kill -9 <PID>
     ```

2. **Python Virtual Environment Issues**
   - Windows: Make sure to use the correct activation script in `\.venv\Scripts\`
   - macOS/Linux: 
     ```bash
     # Fix permissions
     chmod -R 755 .venv/
     # If using different Python versions
     python3.11 -m venv .venv --clear
     ```

3. **Linux-specific Issues**
   - Package installation permission errors:
     ```bash
     sudo apt-get update
     sudo apt-get install -y python3-pip
     ```
   - Node.js permission errors:
     ```bash
     sudo chown -R $USER:$GROUP ~/.npm
     sudo chown -R $USER:$GROUP ~/.config
     ```
   - System dependencies:
     ```bash
     sudo apt-get install -y \
         build-essential \
         python3-dev \
         libffi-dev \
         libssl-dev
     ```

3. **Node.js Dependencies Issues**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **AWS Credential Issues**
   - Verify credentials in the Connectors section
   - Ensure IAM user has appropriate permissions
   - Check region settings

### Getting Help

If you encounter any issues:
1. Check the console logs in both frontend and backend terminals
2. Verify all prerequisites are correctly installed
3. Ensure all environment variables are properly set
4. Check AWS IAM permissions

## AWS IAM Requirements

The AWS credentials used should have permissions for:
- EKS cluster creation and management
- VPC and subnet access
- EC2 operations for node groups
- IAM role and policy management

## API Endpoints

Major endpoints available:
- `GET /clusters`: List all EKS clusters
- `POST /clusters`: Create a new cluster
- `DELETE /clusters/{cluster_name}`: Delete a cluster
- `GET /api/aws/regions/{account_id}`: List AWS regions
- `GET /api/aws/vpcs/{account_id}/{region}`: List VPCs in a region
- `GET /api/aws/zones/{account_id}/{region}`: List availability zones
- `POST /api/connections`: Manage AWS connections

## Security Best Practices

1. **AWS Credentials**
   - Never commit AWS credentials to version control
   - Use IAM roles with least privilege principle
   - Regularly rotate access keys
   - Use separate IAM users for different environments

2. **Environment Variables**
   - Keep sensitive data in `.env` files
   - Never commit `.env` files
   - Use different environment files for development/production

3. **General Security**
   - Keep all dependencies updated
   - Follow AWS security best practices
   - Implement proper authentication
   - Use HTTPS in production

## Development Notes

- The backend uses FastAPI for efficient API development
- Frontend is built with React and TypeScript for type safety
- AWS SDK (boto3) is used for AWS operations
- State management tracks local and AWS cluster states
- Multi-region support with dynamic resource discovery

## License

[Add your license information here]
