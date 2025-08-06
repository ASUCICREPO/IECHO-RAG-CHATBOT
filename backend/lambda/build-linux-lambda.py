#!/usr/bin/env python3
import subprocess
import sys
import os
import zipfile
import shutil
import glob

def build_lambda_package():
    print("🔧 Building Linux-compatible Lambda package...")
    
    # Clean up
    if os.path.exists('build'):
        shutil.rmtree('build')
    os.makedirs('build')
    
    try:
        # Copy Lambda function and requirements
        print("📄 Copying Lambda function code...")
        shutil.copy('document-processor/lambda_function.py', 'build/')
        shutil.copy('document-processor/requirements.txt', 'build/')
        
        # Install all dependencies with Linux compatibility
        print("📦 Installing dependencies for Linux...")
        
        # Install boto3 and botocore (pure Python)
        subprocess.run([
            sys.executable, '-m', 'pip', 'install', 
            'boto3>=1.34.0', 'botocore>=1.34.0', 
            '-t', 'build/', '--no-deps'
        ], check=True)
        
        # Install dependencies for boto3/botocore
        subprocess.run([
            sys.executable, '-m', 'pip', 'install',
            'jmespath', 'python-dateutil', 's3transfer', 'urllib3', 'six',
            '-t', 'build/'
        ], check=True)
        
        # Install brotli for Linux
        print("🗜️ Installing brotli for Linux...")
        try:
            # Try to get Linux wheel
            subprocess.run([
                sys.executable, '-m', 'pip', 'download',
                'Brotli>=1.0.9', '--platform', 'linux_x86_64',
                '--python-version', '312', '--only-binary=:all:', '--no-deps'
            ], check=True)
            
            # Extract wheel
            brotli_wheels = glob.glob('Brotli-*.whl')
            if brotli_wheels:
                with zipfile.ZipFile(brotli_wheels[0], 'r') as zip_ref:
                    zip_ref.extractall('build/')
                os.remove(brotli_wheels[0])
                print(f"Extracted Linux brotli wheel: {brotli_wheels[0]}")
            else:
                raise Exception("No wheel found")
        except:
            print("⚠️ Fallback: Installing brotli normally...")
            subprocess.run([
                sys.executable, '-m', 'pip', 'install',
                'brotli>=1.0.9', '-t', 'build/'
            ], check=True)
        
        print("✅ Dependencies installed successfully")
        
        # Clean up unnecessary files
        print("🧹 Cleaning up unnecessary files...")
        cleanup_patterns = [
            'build/**/__pycache__',
            'build/**/*.pyc',
            'build/**/*.pyo',
            'build/**/*.dist-info',
            'build/**/*.egg-info',
            'build/**/tests',
            'build/**/test',
        ]
        
        for pattern in cleanup_patterns:
            for path in glob.glob(pattern, recursive=True):
                if os.path.isdir(path):
                    shutil.rmtree(path)
                elif os.path.isfile(path):
                    os.remove(path)
        
        # Create deployment package
        print("📦 Creating deployment package...")
        package_name = 'document-processor-linux.zip'
        with zipfile.ZipFile(package_name, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zipf:
            for root, dirs, files in os.walk('build'):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, 'build')
                    zipf.write(file_path, arcname)
        
        # Get package size
        package_size = os.path.getsize(package_name) / (1024 * 1024)  # MB
        print(f"✅ Linux-compatible Lambda package created: {package_name} ({package_size:.1f} MB)")
        
        # Verify package contents
        print("\n📋 Package contents:")
        with zipfile.ZipFile(package_name, 'r') as zipf:
            files = zipf.namelist()
            print(f"   Total files: {len(files)}")
            
            # Check for key files
            key_files = ['lambda_function.py', 'boto3/', 'brotli']
            for key_file in key_files:
                found = any(key_file in f for f in files)
                status = "✅" if found else "❌"
                print(f"   {status} {key_file}")
        
        print(f"\n🚀 Ready to deploy! Package size: {package_size:.1f} MB")
        if package_size > 50:
            print("⚠️ Warning: Package is large. Consider using Lambda layers for dependencies.")
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Error during build: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)
    finally:
        # Clean up build directory
        if os.path.exists('build'):
            shutil.rmtree('build')

if __name__ == '__main__':
    build_lambda_package()